// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Rtc (/rtc/ice-servers) endpoints, verbatim.

/** ICE configuration for the softphone peer connection (`GET /rtc/ice-servers`, reused). */
export interface CallIceServersDto {
    readonly iceServers: RTCIceServer[];
    readonly ttlSeconds: number;
}
