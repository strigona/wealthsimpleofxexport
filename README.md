# Wealthsimple OFX Export (maintained fork)

This repository maintains a fork of the original "Wealthsimple export transactions as CSV" userscript, modified to export transactions in OFX format and updated to keep working with Wealthsimple's frontend changes.

- Original script by: "eaglesemanation" — https://greasyfork.org/en/scripts/500403-wealthsimple-export-transactions-as-csv  
- Modified by: Peter Kieser — adds OFX support

This repo contains and maintains the OFX-version of the userscript (WealthsimpleOfxExport.js). The goal is to keep OFX export working with Wealthsimple and to add a few personal improvements.

## Overview

The userscript injects "Export Transactions as OFX" buttons into Wealthsimple's Activity and Account pages. When used, it fetches your account activity via Wealthsimple's GraphQL endpoints and generates OFX files (one file per account) that can be imported into finance software that accepts OFX.

Key points:
- Exports transactions in OFX format (.ofx files).
- Works from both the account-specific activity view and the global Activity feed.
- Fetches transactions directly using the Wealthsimple frontend APIs (requires you to be logged in).
- Intended to be used as a userscript in Violentmonkey/Tampermonkey/Greasemonkey.

## Installation

1. Install a userscript manager in your browser:
   - Violentmonkey (recommended)
   - Tampermonkey
   - Greasemonkey

2. Install the userscript:
   - Either load the `WealthsimpleOfxExport.js` file directly into your userscript manager, or
   - Clone this repository and load the file into your userscript manager.

3. Navigate to https://my.wealthsimple.com and open the Activity page or an Account page. The export buttons should appear near the page header.

## Usage

- Click one of the provided buttons (e.g. "Last 2 Weeks", "This Month", "All") to export transactions for the selected timeframe.
- The script will generate one OFX file per account and trigger downloads in your browser.
- Imported files are plain OFX (SGML) formatted and may be imported into most personal finance software that supports OFX (Quicken, GnuCash, etc.).

## Notes, Limitations & Compatibility

- The script relies on Wealthsimple's frontend GraphQL endpoints and on a browser-stored OAuth cookie; if Wealthsimple changes their APIs, the script may stop working until updated.
- The OFX files are generated based on available transaction metadata. Some transaction types or metadata may not map perfectly to OFX concepts; the script attempts reasonable mappings but there can be differences.
- This repository focuses on maintaining OFX support and compatibility fixes. If you need CSV export, see the original script by eaglesemanation (linked above).

## Development / Contributions

Contributions are welcome (bug reports, fixes for new Wealthsimple changes, or improvements to OFX mapping). When contributing:
- Keep original attribution intact.
- If you modify code, add your own copyright line for your changes and retain the original MIT permission notice.
- Open issues or PRs describing compatibility problems, unexpected transaction mappings, or feature requests.

## Changelog (high level)

- Converted export format from CSV to OFX.
- Improved transaction-type mapping to OFX transaction types.
- Added logic to generate one OFX file per account.
- Added minor quality-of-life and compatibility fixes to better follow Wealthsimple frontend changes.

## License

This project (and the included script) is licensed under the MIT License.

The original script by eaglesemanation is likewise permissively licensed; this fork is a modified version maintained by Peter Kieser. The original attribution is preserved.

For full license text, see the LICENSE file included with this repository.

## Attribution

- Original script: eaglesemanation — https://greasyfork.org/en/scripts/500403-wealthsimple-export-transactions-as-csv  
- OFX modifications and maintenance: Peter Kieser

If you republish or distribute this script, please keep the original attribution and the MIT permission notice intact.
