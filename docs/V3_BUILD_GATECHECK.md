# V3_BUILD_GATECHECK.md

## Fielddesk V3 build gate

Følgende er godkendt før implementering starter:

- V3_FOUNDATION_DESIGN.md er godkendt som build blueprint v1
- Ingen fallback tenant findes
- Ingen implicit tenant resolution findes
- Global admin er ikke tenant-bruger
- Support session er ikke med i fase 1
- Scope håndhæves i backend og forankres i DB
- Tenant resolution sker før login og app-routes
- Invited og onboarding har ikke adgang til almindelig login/app
- DB schema designes før API
- API designes før UI
- UI må ikke drive datamodel eller sikkerhedsmodel
- V2 bruges kun som reference, ikke som fundamentkode