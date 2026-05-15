"""File parsers for LightRAG document upload.

Converts uploaded file bytes (PDF / DOCX / text-based) into plain UTF-8 text
suitable for LightRAG indexing.

Supported formats:
  - .pdf            → pdfplumber (page-by-page text extraction)
  - .docx           → python-docx (paragraphs concatenated with newlines)
  - .txt .md .py .js .ts .json .xml → UTF-8 decode with replacement
"""

from __future__ import annotations

import logging
from io import BytesIO
from pathlib import Path

logger = logging.getLogger(__name__)

# Supported extensions (must match SUPPORTED_EXTENSIONS in the upload endpoint)
TEXT_EXTENSIONS: set[str] = {".txt", ".md", ".py", ".js", ".ts", ".json", ".xml"}
PDF_EXTENSIONS: set[str] = {".pdf"}
DOCX_EXTENSIONS: set[str] = {".docx"}
SUPPORTED_EXTENSIONS: set[str] = TEXT_EXTENSIONS | PDF_EXTENSIONS | DOCX_EXTENSIONS


def _parse_pdf(raw_bytes: bytes) -> str:
    """Extract text from a PDF file using pdfplumber."""
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(BytesIO(raw_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text:
                parts.append(text)
    return "\n\n".join(parts)


def _parse_docx(raw_bytes: bytes) -> str:
    """Extract text from a DOCX file using python-docx (paragraphs only)."""
    from docx import Document  # python-docx

    doc = Document(BytesIO(raw_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text)


def _parse_text(raw_bytes: bytes) -> str:
    """Decode bytes as UTF-8, replacing invalid sequences."""
    return raw_bytes.decode("utf-8", errors="replace")


def parse_file_to_text(raw_bytes: bytes, filename: str) -> str:
    """Dispatch to the correct parser based on file extension.

    Args:
        raw_bytes: Raw file contents from multipart upload
        filename:  Original filename (used only for extension detection)

    Returns:
        Plain-text content, stripped of leading/trailing whitespace.
        Empty string if the file contained no readable text.

    Raises:
        ValueError: If the file extension is not in SUPPORTED_EXTENSIONS.
    """
    ext = Path(filename).suffix.lower()

    if ext in PDF_EXTENSIONS:
        text = _parse_pdf(raw_bytes)
    elif ext in DOCX_EXTENSIONS:
        text = _parse_docx(raw_bytes)
    elif ext in TEXT_EXTENSIONS:
        text = _parse_text(raw_bytes)
    else:
        raise ValueError(
            f"Unsupported file extension: {ext!r}. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
        )

    return text.strip()
