#!/usr/bin/env python3
"""
SFTP browse helper — called by api.php via proc_open().
Credentials are passed via stdin (never via argv or environment).

Input  (stdin):  JSON  {"action":"list"|"get", "path":"...", "user":"...", "password":"..."}
Output (stdout): JSON  {"ok":true,  "entries":[...]}          (list)
                       {"ok":true,  "content":"..."}          (get)
                       {"ok":false, "error":"...", "need_creds":true}  (auth failure)
"""

import sys, json, stat as stat_mod, datetime

try:
    import paramiko
except ImportError:
    print(json.dumps({"ok": False,
                      "error": "paramiko not installed — run: pip install paramiko"}))
    sys.exit(1)

SFTP_HOST = 'observer1.palomar.caltech.edu'
SFTP_PORT = 22

# Re-enable all legacy algorithms for the old Linux SSH server
_LEGACY = dict(
    disabled_algorithms={
        'kex':         [],
        'keys':        [],
        'pubkeys':     [],
        'ciphers':     [],
        'macs':        [],
        'compression': [],
    }
)


def connect(user, password):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kw = dict(look_for_keys=True, allow_agent=True, timeout=15, **_LEGACY)
    if user:
        kw['username'] = user
    if password:
        kw['password'] = password
    client.connect(SFTP_HOST, port=SFTP_PORT, **kw)
    return client, client.open_sftp()


def list_dir(sftp, path):
    try:
        entries = sftp.listdir_attr(path)
    except Exception:
        names   = sftp.listdir(path)
        entries = []
        for name in names:
            try:
                attr          = sftp.stat(f'{path.rstrip("/")}/{name}')
                attr.filename = name
            except Exception:
                attr          = paramiko.SFTPAttributes()
                attr.filename = name
                attr.st_mode  = 0o100644
                attr.st_size  = 0
                attr.st_mtime = 0
            entries.append(attr)

    result = []
    for e in entries:
        is_dir = False
        try:
            is_dir = e.st_mode is not None and stat_mod.S_ISDIR(e.st_mode)
        except Exception:
            pass
        mtime = ''
        try:
            if e.st_mtime:
                mtime = datetime.datetime.fromtimestamp(e.st_mtime).strftime('%Y-%m-%d %H:%M')
        except Exception:
            pass
        result.append({
            'name':   e.filename,
            'is_dir': is_dir,
            'size':   e.st_size or 0,
            'mtime':  mtime,
        })

    result.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    return result


def main():
    try:
        req = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Bad input: {e}"}))
        return

    action   = req.get('action', 'list')
    path     = req.get('path', '/')
    user     = req.get('user', '')
    password = req.get('password', '')

    try:
        client, sftp = connect(user, password)
    except (paramiko.AuthenticationException, paramiko.SSHException):
        print(json.dumps({"ok": False, "error": "Authentication failed",
                          "need_creds": True}))
        return
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return

    try:
        if action == 'list':
            entries = list_dir(sftp, path)
            print(json.dumps({"ok": True, "path": path, "entries": entries}))
        elif action == 'get':
            with sftp.open(path, 'r') as fh:
                content = fh.read().decode(errors='replace')
            print(json.dumps({"ok": True, "content": content}))
        else:
            print(json.dumps({"ok": False, "error": f"Unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
    finally:
        try:
            sftp.close()
            client.close()
        except Exception:
            pass


if __name__ == '__main__':
    main()
