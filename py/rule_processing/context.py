# rule_processing/context.py
"""
Defines the RuleExecutionContext class, a data container for a single rule execution.

This class acts as a central "context" or "state" object that holds all relevant
information needed to process one rule, from start to finish. It is instantiated
at the beginning of a rule execution and passed to the various processing modules
(translator, overrides, actions), eliminating the need to pass a long list of
arguments to every function.
"""

import sqlite3
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class RuleExecutionContext:
    """
    A container for all state and configuration related to a single rule's execution.
    
    This object is created by the orchestrator and passed through the processing pipeline.
    """

    def __init__(self,
                 app_config: Dict[str, Any],
                 db_conn: sqlite3.Connection,
                 rule: Dict[str, Any],
                 run_id: str,
                 rule_execution_id: str,
                 is_manual_run: bool = False,
                 override_bypass_list: Optional[List[str]] = None,
                 deep_run_list: Optional[List[str]] = None):
        """
        Initializes the context for a rule execution.

        Args:
            app_config: The main application configuration dictionary.
            db_conn: The active SQLite database connection.
            rule: The dictionary representing the rule to be executed.
            run_id: The UUID of the parent "Run All Rules" job.
            rule_execution_id: The UUID for this specific rule execution log entry.
            is_manual_run: Flag indicating if the rule is being run manually.
            override_bypass_list: A list of rule IDs to bypass override logic for.
            deep_run_list: A list of `force_in` rule IDs to run in "deep" mode.
        """
        if not all([app_config, db_conn, rule, run_id, rule_execution_id]):
            raise ValueError("All core context arguments must be provided and not be None.")

        # --- Core Dependencies ---
        self.app_config: Dict[str, Any] = app_config
        self.db_conn: sqlite3.Connection = db_conn
        
        # --- Run-Specific Information ---
        self.rule: Dict[str, Any] = rule
        self.run_id: str = run_id
        self.rule_execution_id: str = rule_execution_id
        self.is_manual_run: bool = is_manual_run
        self.override_bypass_list: List[str] = override_bypass_list or []
        self.deep_run_list: List[str] = deep_run_list or []

        # --- Derived Rule Properties (for convenience) ---
        self.rule_id: str = rule.get('id', 'unknown_id')
        self.rule_name: str = rule.get('name', self.rule_id)
        self.rule_importance: int = int(rule.get('priority', 1))
        self.action: Dict[str, Any] = rule.get('action', {})
        self.action_type: str = self.action.get('type', 'unknown')

        # --- Stateful Properties (populated during execution) ---
        
        # Holds the list of all available Hydrus services, fetched once per rule.
        self.available_services: Optional[List[Dict[str, Any]]] = None

    def __repr__(self) -> str:
        """Provides a developer-friendly representation of the context."""
        return (f"<RuleExecutionContext(rule_name='{self.rule_name}', "
                f"rule_id='{self.rule_id[:8]}...', "
                f"exec_id='{self.rule_execution_id[:8]}...')>")