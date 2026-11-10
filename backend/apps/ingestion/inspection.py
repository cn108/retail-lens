"""CSV inspection for dataset upload.

The inspector detects the encoding and delimiter, profiles every column and
infers a storage-neutral type. It never assigns business meaning: a mapping
suggestion is derived from the header name and must be confirmed by the user.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field

MAX_COLUMNS = 200
PREVIEW_ROWS = 5
INFERENCE_ROWS = 1000
SNIFF_BYTES = 64 * 1024
# A column is typed when most values fit; the remainder become quality issues
# during processing instead of blocking the mapping step.
TYPE_THRESHOLD = 0.9

INTEGER = re.compile(r"^[+-]?\d+$")
DECIMAL = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$")
DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%Y/%m/%d",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%d/%m/%Y %H:%M",
)
BOOLEAN_VALUES = frozenset({"true", "false", "yes", "no", "y", "n"})

# Descriptions in retail exports routinely exceed Python's 128 KiB default.
csv.field_size_limit(1024 * 1024)


class CsvInspectionError(ValueError):
    """A file the user must fix before it can be used."""


@dataclass
class ColumnProfile:
    source_name: str
    position: int
    inferred_type: str
    null_count: int
    sample_values: list[str]


@dataclass
class InspectionResult:
    encoding: str
    delimiter: str
    row_count: int
    columns: list[ColumnProfile]
    preview: list[list[str]]
    warnings: list[str] = field(default_factory=list)


def detect_encoding(sample: bytes) -> str:
    if sample.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    for encoding in ("utf-8", "cp1252"):
        try:
            sample.decode(encoding)
        except UnicodeDecodeError:
            continue
        return encoding
    return "latin-1"


def detect_delimiter(sample: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        if dialect.delimiter in ",;\t|":
            return dialect.delimiter
    except csv.Error:
        pass

    lines = sample.splitlines()
    header = lines[0] if lines else ""
    counts = {candidate: header.count(candidate) for candidate in ",;\t|"}
    delimiter = max(counts, key=counts.get)
    return delimiter if counts[delimiter] else ","


class _ColumnAccumulator:
    def __init__(self, name: str, position: int) -> None:
        self.name = name
        self.position = position
        self.null_count = 0
        self.values = 0
        self.integer_matches = 0
        self.decimal_matches = 0
        self.date_matches = 0
        self.boolean_matches = 0
        self.samples: list[str] = []

    def observe(self, value: str) -> None:
        if not value:
            self.null_count += 1
            return
        self.values += 1
        if len(self.samples) < 3 and value not in self.samples:
            self.samples.append(value[:80])

        if INTEGER.match(value):
            self.integer_matches += 1
        if DECIMAL.match(value):
            self.decimal_matches += 1
        if _is_date(value):
            self.date_matches += 1
        if value.lower() in BOOLEAN_VALUES:
            self.boolean_matches += 1

    def _qualifies(self, matches: int) -> bool:
        # Allow up to 10% bad values, or one value in small files, so a single
        # malformed row does not make an otherwise clear column unmappable.
        allowed = max(1, int(self.values * (1 - TYPE_THRESHOLD)))
        return matches > 0 and matches >= self.values - allowed

    @property
    def inferred_type(self) -> str:
        if self.values == 0:
            return "text"
        for name, matches in (
            ("integer", self.integer_matches),
            ("decimal", self.decimal_matches),
            ("date", self.date_matches),
            ("boolean", self.boolean_matches),
        ):
            if self._qualifies(matches):
                return name
        return "text"

    def profile(self) -> ColumnProfile:
        return ColumnProfile(
            source_name=self.name,
            position=self.position,
            inferred_type=self.inferred_type,
            null_count=self.null_count,
            sample_values=self.samples,
        )


def _is_date(value: str) -> bool:
    from datetime import datetime

    for fmt in DATE_FORMATS:
        try:
            datetime.strptime(value, fmt)
        except ValueError:
            continue
        return True
    return False


def _validate_header(header: list[str]) -> list[str]:
    names = [name.strip() for name in header]
    if not names or not any(names):
        raise CsvInspectionError("The file has an empty header row.")
    if len(names) > MAX_COLUMNS:
        raise CsvInspectionError(f"The file has {len(names)} columns; the limit is {MAX_COLUMNS}.")

    seen: set[str] = set()
    for position, name in enumerate(names, start=1):
        if not name:
            raise CsvInspectionError(f"Column {position} has no header.")
        key = name.casefold()
        if key in seen:
            raise CsvInspectionError(f"The header repeats the column name '{name}'.")
        seen.add(key)
    return names


def inspect_csv(uploaded_file, delimiter: str = "auto") -> InspectionResult:  # type: ignore[no-untyped-def]
    """Profile an uploaded CSV without loading the whole file into memory."""
    uploaded_file.seek(0)
    head = uploaded_file.read(SNIFF_BYTES)
    if not head:
        raise CsvInspectionError("The file is empty.")

    encoding = detect_encoding(head)
    sample = head.decode(encoding, errors="replace")
    chosen_delimiter = delimiter if delimiter in ",;\t|" else detect_delimiter(sample)

    uploaded_file.seek(0)
    wrapper = io.TextIOWrapper(uploaded_file.file, encoding=encoding, newline="")
    try:
        try:
            reader = csv.reader(wrapper, delimiter=chosen_delimiter)
            header = next(reader)
        except StopIteration as exc:
            raise CsvInspectionError("The file has no header row.") from exc
        except csv.Error as exc:
            raise CsvInspectionError(f"The file is not valid CSV: {exc}") from exc

        names = _validate_header(header)
        accumulators = [_ColumnAccumulator(name, index) for index, name in enumerate(names)]
        row_count = 0
        preview: list[list[str]] = []
        width_mismatches = 0

        try:
            for row in reader:
                if not any(value.strip() for value in row):
                    continue
                row_count += 1
                if len(preview) < PREVIEW_ROWS:
                    preview.append(
                        [value.strip() for value in row[: len(names)]]
                        + [""] * max(0, len(names) - len(row))
                    )
                if len(row) != len(names):
                    width_mismatches += 1
                if row_count <= INFERENCE_ROWS:
                    for index, accumulator in enumerate(accumulators):
                        value = row[index].strip() if index < len(row) else ""
                        accumulator.observe(value)
        except csv.Error as exc:
            raise CsvInspectionError(f"The file is not valid CSV: {exc}") from exc
    finally:
        wrapper.detach()

    uploaded_file.seek(0)

    if row_count == 0:
        raise CsvInspectionError("The file has a header but no data rows.")

    warnings: list[str] = []
    if width_mismatches:
        warnings.append(
            f"{width_mismatches} of {row_count} rows had a different number of fields; "
            "missing values were treated as empty and extra values were ignored."
        )

    for accumulator in accumulators:
        inferred = accumulator.inferred_type
        matches = {
            "integer": accumulator.integer_matches,
            "decimal": accumulator.decimal_matches,
            "date": accumulator.date_matches,
            "boolean": accumulator.boolean_matches,
        }.get(inferred, 0)
        if inferred != "text" and matches < accumulator.values:
            warnings.append(
                f"'{accumulator.name}' has {accumulator.values - matches} value(s) that "
                f"do not look like {inferred}; those rows will be rejected during "
                "processing and reported as quality issues."
            )

    if any(
        "/" in value
        for accumulator in accumulators
        if accumulator.inferred_type == "date"
        for value in accumulator.samples
    ):
        warnings.append(
            "Dates are read day-first (DD/MM/YYYY); rows that use month-first order must "
            "be cleaned in the source before processing."
        )

    return InspectionResult(
        encoding=encoding,
        delimiter=chosen_delimiter,
        row_count=row_count,
        columns=[accumulator.profile() for accumulator in accumulators],
        preview=preview or [],
        warnings=warnings,
    )
