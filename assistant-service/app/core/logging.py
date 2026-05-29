from __future__ import annotations

import structlog
import logging
import sys
import os

from typing import Any


def setup_logging() -> None:
    """
    Configure stdlib logging and structlog
    """

    # Get log level from env var
    log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_str, logging.INFO)

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )

    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
    )


def get_logger(**context: Any) -> structlog.BoundLogger:
    """
    Return a structlog logger with optional bound context.
    """

    # Apply context
    base = {"service": "assistant-service"}
    base.update(context)

    return structlog.get_logger().bind(**base)

