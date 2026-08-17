# Mobile Form Controls

Status: current UI rule  
Scope: tenant-facing static Fielddesk UI surfaces

On mobile and touch layouts, interactive form controls that can focus text input, open the keyboard, or open a picker must render with `font-size: 16px` or larger.

This includes `input`, `select`, `textarea`, date/time/search/number/password controls, modal and drawer fields, editable QA/project equipment fields, scanner manual-entry fields, tenant-admin controls, and dynamically generated controls styled through the shared field classes.

Do not prevent iOS focus zoom by disabling user zoom. Viewport settings must not use `user-scalable=no`, `maximum-scale=1`, or equivalent accessibility hacks. Keep pinch zoom and normal browser accessibility behavior available.

Desktop typography can stay smaller where the UI design needs it, but a later mobile/touch CSS rule must preserve the 16px minimum for focusable form controls.