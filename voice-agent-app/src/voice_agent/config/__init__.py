"""Environment-backed configuration, validated once at startup."""

from .settings import PROJECT_ROOT, Config, ConfigError

__all__ = ["PROJECT_ROOT", "Config", "ConfigError"]
