Set shell = CreateObject("WScript.Shell")
Dim cmd
cmd = "cmd.exe /k ""cd /d C:\Users\ribei\projects\planner-lidart-claude"
cmd = cmd & " && del /f /q .git\index.lock 2>nul"
cmd = cmd & " && del /f /q .git\config.lock 2>nul"
cmd = cmd & " && set PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs"
cmd = cmd & " && git add -A"
cmd = cmd & " && git commit -m ""Snapshot inicial do Lidart (versao local)"""
cmd = cmd & " && git push -u github claude/lidart-project-continuation-7vyv6m"
cmd = cmd & " && echo."
cmd = cmd & " && echo === PUSH CONCLUIDO! Pressione qualquer tecla para fechar. ==="
cmd = cmd & " && pause"""
shell.Run cmd, 1, False
