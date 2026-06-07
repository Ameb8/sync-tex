from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.extras


@contextmanager
def db_connection(database_url: str) -> Iterator[psycopg2.extensions.connection]:
    conn = psycopg2.connect(database_url)
    try:
        yield conn
    finally:
        conn.close()


def fetch_user_by_email(database_url: str, email: str) -> dict[str, Any] | None:
    with db_connection(database_url) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
            cursor.execute(
                "SELECT id, email, name, oauth_provider, oauth_id, created_at "
                "FROM users WHERE email = %s",
                (email,),
            )
            row = cursor.fetchone()
    return dict(row) if row else None
