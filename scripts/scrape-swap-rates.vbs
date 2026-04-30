' Hidden-window launcher for the daily RBNZ swap-rates scrape.
' Wired up in Windows Task Scheduler -- runs npm without flashing a console.
'
' Setup (one-time):
'   1. Edit ROOT_PATH below if the repo lives somewhere other than
'      C:\Users\chris\Documents\tanta-pipeline.
'   2. Open Task Scheduler -> Create Task...
'      - Name: Tanta Swap Rate Sync
'      - Run whether user is logged on or not
'      - Trigger: Daily at 08:30 (so RBNZ has published the previous day's close)
'      - Action: Start a program
'        Program: wscript.exe
'        Arguments: "C:\Users\chris\Documents\tanta-pipeline\scripts\scrape-swap-rates.vbs"
'   3. Save. Test by running the task manually -- no window should appear.
'      Logs land in scripts\swap-rates.log next to this file.

Option Explicit

Dim ROOT_PATH, NPM_CMD, LOG_FILE, CMD, shell, fso, ts

ROOT_PATH = "C:\Users\chris\Documents\tanta-pipeline"
NPM_CMD   = "npm.cmd run scrape:swap-rates"
LOG_FILE  = ROOT_PATH & "\scripts\swap-rates.log"

' Stamp the log so we can tell runs apart.
Set fso = CreateObject("Scripting.FileSystemObject")
Set ts  = fso.OpenTextFile(LOG_FILE, 8, True) ' 8 = ForAppending, create if missing
ts.WriteLine "----- " & Now & " -----"
ts.Close

' cmd.exe /c "cd /d <root> && npm run scrape:swap-rates >> log 2>&1"
CMD = "cmd.exe /c " & Chr(34) & "cd /d " & ROOT_PATH & " && " & NPM_CMD & " >> " & Chr(34) & LOG_FILE & Chr(34) & " 2>&1" & Chr(34)

Set shell = CreateObject("WScript.Shell")
' shell.Run(command, windowStyle, waitOnReturn)
'   windowStyle 0  = hidden
'   waitOnReturn True so the task runs to completion before exiting
shell.Run CMD, 0, True
