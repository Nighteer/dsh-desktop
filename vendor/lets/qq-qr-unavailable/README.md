# LETS QQ QR compatibility adapter

This is LETS-owned code, not Tencent's QQ connector SDK. The desktop resolution
replaces the connector import with this adapter so that the original UNLICENSED
SDK is absent from the installed and packaged dependency graph. It has no
dependencies and fails explicitly when QR onboarding is requested. Manual QQ
AppID/AppSecret configuration continues through the separately licensed bot SDK.

Keep the versioned archive immutable. Change the version and archive name for
future revisions. Review upstream licensing before restoring QR onboarding.
