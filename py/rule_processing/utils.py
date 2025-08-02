# rule_processing/utils.py
"""
Generic utility functions for the rule processing package.

These functions provide support for various tasks like data manipulation,
parsing, and object creation that are used across different modules
of the rule processing logic.
"""
import logging
from datetime import datetime, timedelta
from urllib.parse import unquote

logger = logging.getLogger(__name__)


def get_rule_by_id(rule_id_to_find, rules_list):
    """Finds a rule dictionary from a list by its ID."""
    if not rule_id_to_find or not isinstance(rules_list, list):
        return None
    return next((rule for rule in rules_list if isinstance(rule, dict) and rule.get('id') == rule_id_to_find), None)


def create_default_details():
    """Creates a dictionary with default values for rule execution details."""
    return {
        "translation_warnings": [],
        "action_tag_service_key_used_for_search": None,
        "files_skipped_due_to_recent_view": 0,
        "files_skipped_due_to_override": 0,
        "metadata_errors": [],
        "action_processing_results": [],
        "critical_error": None,
        "critical_error_traceback_summary": None,
    }


def parse_time_range_for_logs(args):
    """
    Parses time frame parameters (e.g., '24h', '1w', custom 'start_date', 'end_date')
    from Flask request.args into ISO 8601 datetime strings suitable for database queries.
    """
    time_frame = args.get('time_frame', '1w')  # Default to 1 week
    start_date_str = args.get('start_date')
    end_date_str = args.get('end_date')

    now = datetime.utcnow()
    end_dt = now  # Default end is now
    time_frame_used_for_response = time_frame  # Store the initial or determined time_frame label

    if start_date_str:  # Custom date range takes precedence
        try:
            # Handle URL encoded '+' for timezone, or 'Z'
            start_date_str_decoded = unquote(start_date_str)
            if 'T' in start_date_str_decoded:  # Full ISO string likely
                start_dt = datetime.fromisoformat(start_date_str_decoded.replace('Z', '+00:00'))
            else:  # Assume YYYY-MM-DD, set to start of day UTC
                start_dt = datetime.strptime(start_date_str_decoded, '%Y-%m-%d').replace(hour=0, minute=0, second=0, microsecond=0)

            if end_date_str:
                end_date_str_decoded = unquote(end_date_str)
                if 'T' in end_date_str_decoded:  # Full ISO string likely
                    end_dt = datetime.fromisoformat(end_date_str_decoded.replace('Z', '+00:00'))
                else:  # Assume YYYY-MM-DD, set to end of day UTC
                    end_dt = datetime.strptime(end_date_str_decoded, '%Y-%m-%d').replace(hour=23, minute=59, second=59, microsecond=999999)
            else:  # If start_date is given but no end_date, end_date is now
                end_dt = now  # Which is already set
            time_frame_used_for_response = "custom"
        except ValueError:
            logger.warning(f"Invalid custom date format. Falling back to default time_frame '{time_frame}'. Dates: {start_date_str}, {end_date_str}")
            # Fallback to default time_frame if parsing fails
            time_frame = '1w'  # Reset to default '1w' or some other sensible default
            start_dt = now - timedelta(weeks=1)
            end_dt = now
            time_frame_used_for_response = time_frame  # Update to actual used frame

    elif time_frame == '24h':
        start_dt = now - timedelta(hours=24)
        time_frame_used_for_response = "24h"
    elif time_frame == '3d':
        start_dt = now - timedelta(days=3)
        time_frame_used_for_response = "3d"
    elif time_frame == '1w':
        start_dt = now - timedelta(weeks=1)
        time_frame_used_for_response = "1w"
    elif time_frame == '1m':
        start_dt = now - timedelta(days=30)  # Approx 1 month
        time_frame_used_for_response = "1m"
    elif time_frame == '6m':
        start_dt = now - timedelta(days=180)  # Approx 6 months
        time_frame_used_for_response = "6m"
    elif time_frame == '1y':
        start_dt = now - timedelta(days=365)  # Approx 1 year
        time_frame_used_for_response = "1y"
    elif time_frame == 'all':
        start_dt = datetime.min  # Represents earliest possible time
        time_frame_used_for_response = "all"
    else:  # Default / unrecognized time_frame
        logger.warning(f"Unrecognized time_frame '{time_frame}'. Defaulting to '1w'.")
        start_dt = now - timedelta(weeks=1)
        time_frame_used_for_response = "1w"  # Use the actual default applied

    # Convert to ISO strings suitable for SQLite TEXT comparison (assuming stored as UTC 'Z' format)
    # For 'all' time, datetime.min is used.
    start_iso = start_dt.isoformat() + "Z" if time_frame_used_for_response != 'all' else (datetime.min.isoformat() + "Z")
    end_iso = end_dt.isoformat() + "Z"  # end_dt is always a specific datetime

    return start_iso, end_iso, time_frame_used_for_response