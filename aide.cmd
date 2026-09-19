@echo off
set "AIDE_NODE=%~dp0runtime\node\node.exe"
if not exist "%AIDE_NODE%" set "AIDE_NODE=node"
"%AIDE_NODE%" "%~dp0bin\aide.mjs" %*
