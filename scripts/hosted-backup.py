#!/usr/bin/env python3
"""Consistent demo backup: take the worker lock, snapshot SQLite, then tenant files.
The API may enqueue new work during the backup; its snapshot is the recovery point.
No repository code is executed. Stop the worker before invoking this operator tool.
"""
import fcntl
import os
import pathlib
import sqlite3
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone

root = pathlib.Path(os.environ['LAUNCHLAB_HOSTED_DATA'])
with (root / 'worker.flock').open('a') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('Backup deferred: worker owns the data lock.')
        raise SystemExit(0)
    with tempfile.TemporaryDirectory(prefix='launchlab-backup-') as temporary:
        directory = pathlib.Path(temporary)
        with sqlite3.connect(root / 'service.sqlite') as source, sqlite3.connect(directory / 'service.sqlite') as destination:
            source.backup(destination)
        archive = directory / 'backup.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            bundle.add(directory / 'service.sqlite', arcname='service.sqlite')
            if (root / 'tenants').exists():
                bundle.add(root / 'tenants', arcname='tenants')
        key = datetime.now(timezone.utc).strftime('backups/%Y-%m-%d/%H-%M-%S.tar.gz')
        subprocess.run(['aws', 's3', 'cp', str(archive), f"s3://{os.environ['LAUNCHLAB_BACKUP_BUCKET']}/{key}",
                        '--region', os.environ['AWS_REGION'], '--sse', 'AES256', '--only-show-errors'], check=True)
        print('Encrypted service backup stored.')
