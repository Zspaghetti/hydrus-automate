import os
import sqlite3
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DB_DIR = os.path.join(BASE_DIR, 'db')
AUTOMATION_DB_FILE = os.path.join(DB_DIR, 'automation_state.db')

def init_db():
    """
    Initializes the database schema with all required tables and indexes.
    This function creates `rules`, `run_logs`, `logs`, and the `files` state table.
    """
    logger.info("--- Initializing Automation Database Schema ---")
    conn = None
    try:
        if not os.path.exists(DB_DIR):
            os.makedirs(DB_DIR)
            logger.info(f"Created database directory: {DB_DIR}")

        conn = sqlite3.connect(AUTOMATION_DB_FILE)
        cursor = conn.cursor()

        # Table for a simple registry of all known rules.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS rules (
                rule_id TEXT PRIMARY KEY,
                rule_name TEXT NOT NULL,
                has_been_run INTEGER NOT NULL DEFAULT 0,
                creation_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                execution_override TEXT,
                interval_seconds INTEGER,
                force_in_check_frequency TEXT NOT NULL DEFAULT 'first_run_only',
                force_in_check_interval_runs INTEGER,
                run_count INTEGER NOT NULL DEFAULT 0
            )
        ''')
        logger.info("Table 'rules' initialized/verified.")

        # Table for organizing rules into user-defined sets.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS rule_sets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                execution_override TEXT,
                interval_seconds INTEGER
            )
        ''')
        logger.info("Table 'rule_sets' initialized/verified.")

        # Association table to link rules to rule_sets (many-to-many).
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS rule_set_associations (
                rule_id TEXT NOT NULL,
                set_id TEXT NOT NULL,
                FOREIGN KEY (rule_id) REFERENCES rules (rule_id) ON DELETE CASCADE,
                FOREIGN KEY (set_id) REFERENCES rule_sets (id) ON DELETE CASCADE,
                PRIMARY KEY (rule_id, set_id)
            )
        ''')
        logger.info("Table 'rule_set_associations' initialized/verified.")

        # Table for run-level summary logs.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS run_logs (
                run_log_id TEXT PRIMARY KEY,
                parent_run_id TEXT NOT NULL,
                rule_id TEXT NOT NULL,
                rule_name TEXT NOT NULL,
                execution_order INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                status TEXT NOT NULL,
                matched_search_count INTEGER,
                eligible_for_action_count INTEGER,
                actions_succeeded_count INTEGER,
                actions_failed_count INTEGER,
                summary_message TEXT,
                details_json TEXT
            )
        ''')
        logger.info("Table 'run_logs' (for run summaries) initialized/verified.")

        # Table for detailed, file-level action history.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS logs (
                log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_log_id TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                status TEXT NOT NULL,
                details_json TEXT NOT NULL,
                message TEXT,
                FOREIGN KEY (run_log_id) REFERENCES run_logs (run_log_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_run_log_id ON logs (run_log_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_file_hash ON logs (file_hash)')
        logger.info("Table 'logs' (for file-level details) initialized/verified.")

        # Table for the core state of the override system. One row per file.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS files (
                file_hash TEXT PRIMARY KEY,
                rules_in_application TEXT NOT NULL DEFAULT '[]',
                force_in_priority_governance INTEGER NOT NULL DEFAULT -1,
                correct_placement TEXT NOT NULL DEFAULT '[]',
                affected_rating_services TEXT NOT NULL DEFAULT '[]',
                rating_priority_governance TEXT NOT NULL DEFAULT '{}',
                last_updated TEXT NOT NULL
            )
        ''')
        logger.info("Table 'files' (state machine) initialized/verified.")

        # Table for storing generic key-value application state.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        logger.info("Table 'app_state' (for key-value state) initialized/verified.")

        conn.commit()
        logger.info(f"Database schema initialized/verified at {AUTOMATION_DB_FILE}")

    except sqlite3.Error as e:
        logger.critical(f"CRITICAL ERROR initializing database schema: {e}")
        if conn: conn.rollback()
        raise
    finally:
        if conn: conn.close()
        logger.info("--- Finished Initializing Database ---")


def get_db_connection(db_file=AUTOMATION_DB_FILE):
    """Establishes and returns a database connection."""
    try:
        conn = sqlite3.connect(db_file, timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        logger.error(f"Error connecting to database {db_file}: {e}")
        raise


def start_run_log(db_conn, run_log_id, parent_run_id, rule, execution_order):
    """Logs the start of a new rule execution in the summary table."""
    cursor = db_conn.cursor()
    cursor.execute('''
        INSERT INTO run_logs (
            run_log_id, parent_run_id, rule_id, rule_name, execution_order,
            start_time, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        run_log_id, parent_run_id, rule['id'], rule['name'], execution_order,
        datetime.utcnow().isoformat() + "Z", "started"
    ))

def update_run_log_summary(db_conn, run_log_id, status, counts, summary_message, details_json):
    """Updates the run summary log with the final results."""
    cursor = db_conn.cursor()
    cursor.execute('''
        UPDATE run_logs
        SET end_time = ?, status = ?, matched_search_count = ?,
            eligible_for_action_count = ?, actions_succeeded_count = ?,
            actions_failed_count = ?, summary_message = ?, details_json = ?
        WHERE run_log_id = ?
    ''', (
        datetime.utcnow().isoformat() + "Z", status,
        counts['matched'], counts['eligible'], counts['succeeded'],
        counts['failed'], summary_message, details_json, run_log_id
    ))

def log_file_event(db_conn, run_log_id, file_hash, status, details_dict, message=None):
    """Logs an event for a single file to the detailed `logs` table."""
    cursor = db_conn.cursor()
    cursor.execute('''
        INSERT INTO logs (run_log_id, file_hash, status, details_json, message)
        VALUES (?, ?, ?, ?, ?)
    ''', (
        run_log_id, file_hash, status, json.dumps(details_dict), message
    ))

def mark_rule_as_run(db_conn, rule_id):
    """Marks a rule as having been run at least once."""
    cursor = db_conn.cursor()
    cursor.execute(
        "UPDATE rules SET has_been_run = 1 WHERE rule_id = ?",
        (rule_id,)
    )

def get_rules_first_run_status(db_conn, rule_ids):
    """
    Checks a list of rule IDs and returns which ones have not been run yet.
    Returns a dictionary mapping rule_id to a boolean (True if it needs first run).
    """
    statuses = {}
    if not rule_ids:
        return statuses

    placeholders = ','.join('?' for _ in rule_ids)
    query = f"SELECT rule_id, has_been_run FROM rules WHERE rule_id IN ({placeholders})"
    
    cursor = db_conn.cursor()
    cursor.execute(query, rule_ids)
    
    results = {row['rule_id']: bool(row['has_been_run']) for row in cursor.fetchall()}
    
    # The API expects a dictionary of {rule_id: needs_first_run_bool}
    # A rule needs its first run if its `has_been_run` flag is False (0).
    for rule_id in rule_ids:
        # If a rule isn't in the DB 'rules' table, it definitely needs a first run.
        has_run = results.get(rule_id, False)
        statuses[rule_id] = not has_run
        
    return statuses


def clear_rule_from_file_state(db_conn, edited_rule_id, edited_rule_old_type, edited_rule_old_destination):
    """
    Finds all files affected by a changed/deleted rule and removes its influence from the state table.
    This prevents outdated overrides from persisting.
    """
    old_type = edited_rule_old_type
    old_dest = edited_rule_old_destination

    logger.info(f"Clearing state for rule '{edited_rule_id}' (Old Type: {old_type}, Old Dest: {old_dest})")
    
    cursor = db_conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM files WHERE rules_in_application LIKE ?",
            (f'%"{edited_rule_id}"%',)
        )
        affected_files = cursor.fetchall()
        logger.info(f"Found {len(affected_files)} file states to clean for rule '{edited_rule_id}'.")

        if not affected_files:
            return 0

        updated_count = 0
        for row in affected_files:
            file_hash = row['file_hash']
            
            rules_app = json.loads(row['rules_in_application'])
            placements = json.loads(row['correct_placement'])
            rating_services = json.loads(row['affected_rating_services'])
            rating_gov = json.loads(row['rating_priority_governance'])
            force_in_gov = row['force_in_priority_governance']

            if edited_rule_id in rules_app:
                rules_app.remove(edited_rule_id)

            if old_type == 'rating':
                if old_dest in rating_services:
                    rating_services.remove(old_dest)
                if old_dest in rating_gov:
                    del rating_gov[old_dest]
            
            elif old_type == 'force_in':
                if old_dest in placements:
                    placements.remove(old_dest)
                force_in_gov = -1

            elif old_type == 'add_to':
                if old_dest in placements:
                    placements.remove(old_dest)

            cursor.execute('''
                UPDATE files SET
                    rules_in_application = ?,
                    force_in_priority_governance = ?,
                    correct_placement = ?,
                    affected_rating_services = ?,
                    rating_priority_governance = ?,
                    last_updated = ?
                WHERE file_hash = ?
            ''', (
                json.dumps(rules_app),
                force_in_gov,
                json.dumps(placements),
                json.dumps(rating_services),
                json.dumps(rating_gov),
                datetime.utcnow().isoformat() + "Z",
                file_hash
            ))
            updated_count += 1
        
        db_conn.commit()
        logger.info(f"Successfully cleaned state for {updated_count} files for rule '{edited_rule_id}'.")
        return updated_count

    except (json.JSONDecodeError, sqlite3.Error, TypeError) as e:
        logger.error(f"Failed to clear state for rule '{edited_rule_id}'. Rolling back. Error: {e}", exc_info=True)
        db_conn.rollback()
        return -1


def prune_duplicate_logs(db_conn, keep_oldest=2, keep_newest=3):
    """
    Cleans the logs table by removing excessive duplicate entries for the same file, rule, and status.
    """
    total_to_keep = keep_oldest + keep_newest
    logger.info("Starting log pruning task...")
    
    cursor = db_conn.cursor()
    try:
        cursor.execute(f'''
            SELECT file_hash, run_log_id, status, message, COUNT(*) as cnt
            FROM logs
            GROUP BY file_hash, run_log_id, status, message
            HAVING cnt > {total_to_keep}
        ''')
        groups_to_prune = cursor.fetchall()
        
        total_deleted = 0
        if not groups_to_prune:
            logger.info("No log groups require pruning.")
            return 0

        logger.info(f"Found {len(groups_to_prune)} log groups to prune.")

        for group in groups_to_prune:
            sub_cursor = db_conn.cursor()
            sub_cursor.execute('''
                SELECT log_id FROM logs
                WHERE file_hash = ? AND run_log_id = ? AND status = ? AND message = ?
                ORDER BY log_id ASC
            ''', (group['file_hash'], group['run_log_id'], group['status'], group['message']))
            
            log_ids = [row['log_id'] for row in sub_cursor.fetchall()]
            
            ids_to_delete = log_ids[keep_oldest:-keep_newest]
            
            if ids_to_delete:
                placeholders = ','.join('?' for _ in ids_to_delete)
                delete_cursor = db_conn.cursor()
                delete_cursor.execute(f'DELETE FROM logs WHERE log_id IN ({placeholders})', ids_to_delete)
                total_deleted += delete_cursor.rowcount
        
        db_conn.commit()
        logger.info(f"Log pruning complete. Deleted {total_deleted} redundant log entries.")
        return total_deleted

    except sqlite3.Error as e:
        logger.error(f"Database error during log pruning. Rolling back. Error: {e}")
        db_conn.rollback()
        return -1


def get_rules(db_conn):
    """Fetches all rules and their properties from the database."""
    cursor = db_conn.cursor()
    cursor.execute("SELECT * FROM rules")
    return [dict(row) for row in cursor.fetchall()]


def save_rule(db_conn, rule_data):
    """
    Saves a single rule's properties to the database.
    This creates a new rule entry or updates an existing one.
    It specifically handles scheduling and the new force_in frequency.
    """
    cursor = db_conn.cursor()
    cursor.execute('''
        INSERT INTO rules (
            rule_id, rule_name, execution_override, interval_seconds, force_in_check_frequency,
            force_in_check_interval_runs
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(rule_id) DO UPDATE SET
            rule_name = excluded.rule_name,
            execution_override = excluded.execution_override,
            interval_seconds = excluded.interval_seconds,
            force_in_check_frequency = excluded.force_in_check_frequency,
            force_in_check_interval_runs = excluded.force_in_check_interval_runs
    ''', (
        rule_data.get('id'),
        rule_data.get('name'),
        rule_data.get('execution_override'),
        rule_data.get('interval_seconds'),
        rule_data.get('force_in_check_frequency', 'first_run_only'),
        rule_data.get('force_in_check_interval_runs') # Get new field for the interval number
    ))
    # Note: Commit is no longer done here, it will be handled by the calling function
    # to ensure atomicity across multiple operations (e.g., creating copies).
    
def increment_rule_run_count(db_conn, rule_id):
    """Increments the run_count for a specific rule by 1."""
    cursor = db_conn.cursor()
    cursor.execute(
        "UPDATE rules SET run_count = run_count + 1 WHERE rule_id = ?",
        (rule_id,)
    )

def add_rule_to_set(db_conn, rule_id, set_id):
    """Associates a single rule with a single set."""
    if not rule_id or not set_id:
        return
    cursor = db_conn.cursor()
    cursor.execute(
        "INSERT OR IGNORE INTO rule_set_associations (rule_id, set_id) VALUES (?, ?)",
        (rule_id, set_id)
    )

def update_rule_set_association(db_conn, rule_id, new_set_id):
    """Removes old associations for a rule and adds the new one."""
    if not rule_id:
        return
    cursor = db_conn.cursor()
    # First, remove any existing associations for this rule
    cursor.execute("DELETE FROM rule_set_associations WHERE rule_id = ?", (rule_id,))
    # If a new set was provided, add the new association
    if new_set_id:
        add_rule_to_set(db_conn, rule_id, new_set_id)


def get_all_set_data(db_conn):
    """
    Fetches all rule sets and their associations.
    Returns a dictionary with 'sets' and 'associations' keys, suitable for API responses.
    """
    try:
        sets_cursor = db_conn.cursor()
        sets_cursor.execute("SELECT * FROM rule_sets")
        sets = [dict(row) for row in sets_cursor.fetchall()]

        assoc_cursor = db_conn.cursor()
        assoc_cursor.execute("SELECT rule_id, set_id FROM rule_set_associations")
        associations = [dict(row) for row in assoc_cursor.fetchall()]

        return {"sets": sets, "associations": associations}
    except sqlite3.Error as e:
        logger.error(f"Error fetching set data: {e}")
        return {"sets": [], "associations": []}

def save_set_configuration(db_conn, data):
    """
    Wipes and replaces the entire rule set configuration in a single transaction.
    This is the main function for saving changes from the Set Editor.
    """
    cursor = db_conn.cursor()
    try:
        # Wipe existing set and association data
        cursor.execute("DELETE FROM rule_set_associations")
        cursor.execute("DELETE FROM rule_sets")

        # Insert new set definitions
        for s in data.get('sets', []):
            cursor.execute(
                "INSERT INTO rule_sets (id, name, execution_override, interval_seconds) VALUES (?, ?, ?, ?)",
                (
                    s['id'],
                    s['name'],
                    s.get('execution_override'),
                    s.get('interval_seconds')
                )
            )

        # Insert new associations
        for assoc in data.get('associations', []):
            cursor.execute(
                "INSERT INTO rule_set_associations (rule_id, set_id) VALUES (?, ?)",
                (assoc['rule_id'], assoc['set_id'])
            )

        db_conn.commit()
        logger.info(f"Successfully saved set configuration. {len(data.get('sets', []))} sets, {len(data.get('associations', []))} associations.")
        return True
    except (sqlite3.Error, KeyError) as e:
        db_conn.rollback()
        logger.error(f"Failed to save set configuration. Transaction rolled back. Error: {e}")
        return False


def remove_rule_from_set(db_conn, rule_id, set_id):
    """Removes a single, specific association between a rule and a set."""
    cursor = db_conn.cursor()
    try:
        cursor.execute(
            "DELETE FROM rule_set_associations WHERE rule_id = ? AND set_id = ?",
            (rule_id, set_id)
        )
        db_conn.commit()
        logger.info(f"DB operation to remove association between rule '{rule_id}' and set '{set_id}' executed and committed.")
    except sqlite3.Error as e:
        db_conn.rollback()
        logger.error(f"Failed to execute DB operation to remove association between rule '{rule_id}' and set '{set_id}'. Rolling back. Error: {e}")
        raise


def delete_set(db_conn, set_id):
    """Deletes a set and its associations from the database."""
    cursor = db_conn.cursor()
    try:
        # The ON DELETE CASCADE on the foreign key in rule_set_associations
        # handles deleting the associations automatically.
        cursor.execute("DELETE FROM rule_sets WHERE id = ?", (set_id,))
        db_conn.commit()
        logger.info(f"Successfully deleted set with id '{set_id}'.")
    except sqlite3.Error as e:
        db_conn.rollback()
        logger.error(f"Failed to delete set '{set_id}'. Transaction rolled back. Error: {e}")
        raise
        
def get_app_state(db_conn, key, default=None):
    """Fetches a value from the app_state key-value table."""
    cursor = db_conn.cursor()
    cursor.execute("SELECT value FROM app_state WHERE key = ?", (key,))
    row = cursor.fetchone()
    return row['value'] if row else default

def set_app_state(db_conn, key, value):
    """Sets a value in the app_state key-value table."""
    cursor = db_conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",
        (key, str(value)) # Ensure value is stored as text
    )

def get_last_run_timestamp_for_rule(db_conn, rule_id):
    """
    Gets the last run time for a rule directly from the run_logs table.
    This is more reliable than the old app_state.json.
    """
    cursor = db_conn.cursor()
    cursor.execute(
        "SELECT MAX(start_time) FROM run_logs WHERE rule_id = ?",
        (rule_id,)
    )
    row = cursor.fetchone()
    return row[0] if row and row[0] else None