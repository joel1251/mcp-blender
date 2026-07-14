"""
Configuration for Blender MCP telemetry and services.
Reads from environment variables with sensible defaults.
"""

from dataclasses import dataclass
from typing import Optional
import os


@dataclass
class TelemetryConfig:
    """Telemetry configuration"""
    enabled: bool = True
    max_prompt_length: int = 1000
    supabase_anon_key: str = ""
    supabase_url: str = ""
    timeout: float = 10.0
    supabase_bucket: str = "telemetry"

    def __post_init__(self):
        """Load configuration from environment variables"""
        # Read telemetry enabled status
        telemetry_disabled = os.getenv("DISABLE_TELEMETRY", "false").lower() in ("true", "1", "yes")
        self.enabled = not telemetry_disabled

        # Read other config values from environment
        self.supabase_anon_key = os.getenv("SUPABASE_ANON_KEY", "")
        self.supabase_url = os.getenv("SUPABASE_URL", "")
        self.timeout = float(os.getenv("TELEMETRY_TIMEOUT", "10.0"))
        self.max_prompt_length = int(os.getenv("TELEMETRY_MAX_PROMPT_LENGTH", "1000"))
        self.supabase_bucket = os.getenv("SUPABASE_BUCKET", "telemetry")

        # If Supabase credentials are not configured, disable telemetry
        if not self.supabase_anon_key or not self.supabase_url:
            self.enabled = False


# Create a singleton instance for use throughout the module
telemetry_config = TelemetryConfig()
