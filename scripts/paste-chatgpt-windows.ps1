# Runs in Windows PowerShell STA. Zotero supplies the file drop and a UTF-8 JSON request.
using namespace System.Windows.Automation
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = [uri]$request.aiURL
$fileName = [IO.Path]::GetFileName($request.pdfPath)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@ -Name Foreground -Namespace ZoteroAI
[void][ZoteroAI.Foreground]::SetProcessDPIAware()

$descendants = [TreeScope]::Descendants
$editorCondition = [PropertyCondition]::new([AutomationElement]::AutomationIdProperty, 'prompt-textarea')
$attachmentCondition = [PropertyCondition]::new([AutomationElement]::NameProperty, $fileName)
$browserProcesses = @('chrome', 'msedge', 'firefox', 'brave', 'vivaldi', 'opera', 'arc', 'browser', 'zen', 'waterfox', 'librewolf')

function Test-DocumentURL($document) {
    $value = $null
    if (!$document.TryGetCurrentPattern([ValuePattern]::Pattern, [ref]$value)) { return $false }
    $url = $null
    if (![uri]::TryCreate($value.Current.Value, [UriKind]::Absolute, [ref]$url)) { return $false }
    $hostMatches = $url.IdnHost -eq $target.IdnHost -or (
        $target.IdnHost -in @('chat.openai.com', 'www.chatgpt.com') -and $url.IdnHost -eq 'chatgpt.com'
    )
    $sameLocation = $url.AbsolutePath.TrimEnd('/') -ceq $target.AbsolutePath.TrimEnd('/') -and
        (!$target.Query -or $url.Query -ceq $target.Query)
    return $hostMatches -and $url.Scheme -eq $target.Scheme -and $url.Port -eq $target.Port -and
        ($request.useCurrentConversation -or $sameLocation)
}

function Test-VisibleEditor($editor) {
    $bounds = $editor.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { return $false }
    $center = [Windows.Point]::new($bounds.X + $bounds.Width / 2, $bounds.Y + $bounds.Height / 2)
    $hit = [AutomationElement]::FromPoint($center)
    while ($hit -and $hit.Current.ControlType -ne [ControlType]::Document) {
        if ([Automation]::Compare($hit, $editor)) { return $true }
        $hit = [TreeWalker]::RawViewWalker.GetParent($hit)
    }
    return $false
}

function Find-Composer {
    $handle = [ZoteroAI.Foreground]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) { return }
    $window = [AutomationElement]::FromHandle($handle)
    if ((Get-Process -Id $window.Current.ProcessId).ProcessName -notin $browserProcesses) { return }
    foreach ($editor in $window.FindAll($descendants, $editorCondition)) {
        if (!$editor.Current.IsEnabled -or !$editor.Current.IsKeyboardFocusable -or !(Test-VisibleEditor $editor)) { continue }
        $document = $null
        $parent = $editor
        while ($parent -and ![Automation]::Compare($window, $parent)) {
            if ($parent.Current.ControlType -eq [ControlType]::Document) {
                if ($document) { break } # An editor in a nested document is a different paste target.
                $document = $parent
            }
            $parent = [TreeWalker]::RawViewWalker.GetParent($parent)
        }
        if ($parent -and [Automation]::Compare($parent, $window) -and $document -and (Test-DocumentURL $document)) {
            return @{ Handle = $handle; Document = $document; Editor = $editor }
        }
    }
}

function Test-SamePage($page) {
    return $page.Handle -eq [ZoteroAI.Foreground]::GetForegroundWindow() -and
        (Test-DocumentURL $page.Document) -and (Test-VisibleEditor $page.Editor)
}

function Focus-Composer($page) {
    if (!(Test-SamePage $page)) { return $false }
    $page.Editor.SetFocus()
    $focus = [AutomationElement]::FocusedElement
    return $focus -and [Automation]::Compare($focus, $page.Editor) -and (Test-SamePage $page)
}

function Test-FileClipboard {
    $files = [Windows.Forms.Clipboard]::GetFileDropList()
    return $files.Count -eq 1 -and $files[0] -eq $request.pdfPath
}

# Some Gecko/Windows combinations expose the Zotero clipboard item only in Mozilla's format.
if (!(Test-FileClipboard)) {
    if (![IO.File]::Exists($request.pdfPath)) { throw 'Missing local PDF' }
    $files = [Collections.Specialized.StringCollection]::new()
    [void]$files.Add($request.pdfPath)
    [Windows.Forms.Clipboard]::SetFileDropList($files)
}

$deadline = [DateTime]::UtcNow.AddSeconds(30)
$ready = $false
do {
    try {
        $page = Find-Composer
        if ($page -and (Focus-Composer $page)) {
            $ready = $true
            break
        }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        # Browser windows and accessibility nodes can be replaced during navigation.
    }
    Start-Sleep -Milliseconds 300
} while ([DateTime]::UtcNow -lt $deadline)
if (!$ready) { exit 2 }
if ($request.useCurrentConversation) {
    $target = [uri]$page.Document.GetCurrentPattern([ValuePattern]::Pattern).Current.Value
    $request.useCurrentConversation = $false
}

# Compare with the pre-paste count so a filename in existing chat history cannot confirm a new upload.
$previousCount = $page.Document.FindAll($descendants, $attachmentCondition).Count
if (!(Test-FileClipboard) -or !(Focus-Composer $page)) { exit 4 }
[Windows.Forms.SendKeys]::SendWait('^v')
$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
    Start-Sleep -Milliseconds 300
    if ($page.Handle -ne [ZoteroAI.Foreground]::GetForegroundWindow() -or !(Test-FileClipboard)) { exit 4 }
    if ($page.Document.FindAll($descendants, $attachmentCondition).Count -gt $previousCount) {
        if (!$request.prompt) { exit 0 }
        # Uploading can re-render the editor. Resolve it again in the original tab.
        $currentPage = Find-Composer
        if (!$currentPage) { continue }
        if (![Automation]::Compare($page.Document, $currentPage.Document)) { exit 4 }
        if (!(Focus-Composer $currentPage)) { continue }
        [Windows.Forms.Clipboard]::SetText($request.prompt)
        if (!(Test-SamePage $currentPage) -or !$currentPage.Editor.Current.HasKeyboardFocus) { exit 5 }
        [Windows.Forms.SendKeys]::SendWait('^v')
        exit 0
    }
} while ([DateTime]::UtcNow -lt $deadline)
exit 3
