#!/usr/bin/env python3
"""Restore the complete encrypted-release snapshot into a NEW Compose project."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(args):
    return subprocess.check_output(args, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path, help='Decrypted snapshot directory')
    parser.add_argument('--project', default='systemach')
    parser.add_argument('--destination', type=Path, default=Path('/opt/systemach'))
    parser.add_argument('--port', type=int, default=8081)
    parser.add_argument('--portal-url', required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9_-]*', args.project) or args.project == 'hardsystem':
        parser.error('Use a new project name other than hardsystem')
    if not 1 <= args.port <= 65535:
        parser.error('Invalid port')
    snapshot = args.snapshot.resolve()
    manifest = json.loads((snapshot / 'manifest.json').read_text())
    for relative, expected in manifest['source_files'].items():
        path = (snapshot / 'source' / relative).resolve()
        if not path.is_relative_to(snapshot / 'source'):
            raise ValueError('Invalid source path')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Source checksum mismatch: ' + relative)
    suffixes = ['postgres_data', 'attachments_data', 'backups_data', 'caddy_data', 'caddy_config', 'mailpit_data']
    for suffix in suffixes:
        with tarfile.open(snapshot / 'volumes' / (suffix + '.tar')) as archive:
            for member in archive:
                if member.name.startswith('/') or '..' in Path(member.name).parts:
                    raise ValueError('Invalid archive path')
                if member.issym() or member.islnk():
                    if member.linkname.startswith('/') or '..' in Path(member.linkname).parts:
                        raise ValueError('External archive link requires manual restoration')
    if args.verify_only:
        print('Source checksums and six volume archives verified')
        return
    if os.geteuid() != 0:
        raise SystemExit('Run as root on the Docker host')
    target = args.destination.resolve()
    if target.exists():
        raise SystemExit('Destination already exists; nothing was overwritten')
    containers = output(['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=' + args.project, '--format', '{{.ID}}'])
    volumes = set(output(['docker', 'volume', 'ls', '--format', '{{.Name}}']).splitlines())
    networks = set(output(['docker', 'network', 'ls', '--format', '{{.Name}}']).splitlines())
    if containers or any(args.project + '_' + s in volumes for s in suffixes) or any(args.project + '_' + s in networks for s in ['frontend','backend']):
        raise SystemExit('Project resources already exist; nothing was overwritten')
    run(['docker', 'load', '-i', str(snapshot / 'docker-images.tar.gz')])
    images = json.loads((snapshot / 'images.json').read_text())
    for service, tag in [('api', 'latest'), ('web', 'latest'), ('postgres', '17')]:
        run(['docker', 'tag', images[service], args.project + '-' + service + ':' + tag])
    shutil.copytree(snapshot / 'source', target)
    compose = (target / 'compose.yaml').read_text()
    compose = compose.replace('name: hardsystem', 'name: ' + args.project, 1)
    for service in ['web', 'api']:
        compose = compose.replace('  ' + service + ':\n    build:', '  ' + service + ':\n    image: ' + args.project + '-' + service + ':latest\n    build:', 1)
    compose = compose.replace('image: hardsystem-postgres:17', 'image: ' + args.project + '-postgres:17')
    (target / 'compose.yaml').write_text(compose)
    changes = {'HTTP_PORT': str(args.port), 'PORTAL_URL': args.portal_url, 'MAILPIT_HTTP_PORT': '8026'}
    env = [line for line in (target / '.env').read_text().splitlines() if line.split('=', 1)[0] not in changes]
    (target / '.env').write_text('\n'.join(env + [k + '=' + v for k, v in changes.items()]) + '\n')
    (target / '.env').chmod(0o600)
    run(['docker', 'compose', 'config', '--quiet'], cwd=target)
    run(['docker', 'compose', 'create', '--no-build'], cwd=target)
    for suffix in suffixes:
        name = args.project + '_' + suffix
        run(['docker', 'volume', 'create', '--label', 'com.docker.compose.project=' + args.project, '--label', 'com.docker.compose.volume=' + suffix, name], stdout=subprocess.DEVNULL)
        destination = Path(output(['docker', 'volume', 'inspect', name, '--format', '{{.Mountpoint}}']))
        if (destination / 'PG_VERSION').exists():
            raise RuntimeError('Refusing to overwrite initialized PostgreSQL data')
        run(['tar', '--numeric-owner', '-xpf', str(snapshot / 'volumes' / (suffix + '.tar')), '-C', str(destination)])
        if suffix == 'postgres_data':
            version = (destination / 'PG_VERSION').stat()
            os.chown(destination, version.st_uid, version.st_gid)
            destination.chmod(0o700)
    run(['docker', 'compose', 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], cwd=target)
    print('Restored:', target, 'HTTP port:', args.port)


if __name__ == '__main__':
    main()
