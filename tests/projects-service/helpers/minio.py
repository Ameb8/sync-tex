"""
helpers/minio.py — thin wrapper around boto3 for inspecting MinIO state.

Use in tests when you want to assert that objects were actually created/deleted
in object storage, not just trust the API response.

Example:
    from helpers.minio import minio_client, object_exists

    assert object_exists("test-bucket", expected_key)
"""

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

# Must match docker-compose.test.yml minio-test service
MINIO_ENDPOINT = "http://localhost:9099"
MINIO_ACCESS_KEY = "testaccess"
MINIO_SECRET_KEY = "testsecret123"


def minio_client():
    """Return a boto3 S3 client pointed at the test MinIO instance."""
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def object_exists(bucket: str, key: str) -> bool:
    """Return True if the object exists in the given bucket."""
    client = minio_client()
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
            return False
        raise


def list_objects(bucket: str, prefix: str = "") -> list[str]:
    """Return a list of object keys under the given prefix."""
    client = minio_client()
    try:
        response = client.list_objects_v2(Bucket=bucket, Prefix=prefix)
        return [obj["Key"] for obj in response.get("Contents", [])]
    except ClientError:
        return []