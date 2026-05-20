"""SQLAlchemy model registry.

Importing this module ensures every model class is loaded so
`Base.metadata.create_all` can discover and create their tables.
"""

from .agent_tool import AgentTool
from .gemini_api_key import GeminiApiKey
from .srs_job import SrsJob

# BA Kit (M2) models — instance-level template config + runtime job state.
from .template import (
    Template,
    TemplateSection,
    TemplateSectionAgent,
    TemplateSectionExample,
)
from .generation import GenerationJob, GenerationSectionState

__all__ = [
    "AgentTool",
    "GeminiApiKey",
    "SrsJob",
    "Template",
    "TemplateSection",
    "TemplateSectionAgent",
    "TemplateSectionExample",
    "GenerationJob",
    "GenerationSectionState",
]
