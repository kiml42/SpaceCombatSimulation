/**
 * Where an address of the old viewer's goes in the app: a shared battle
 * (`#battle=…`) and an editor's handed fleet (`#fleet=…`) both open the battle
 * route, which reads them from its search. So every link made before the
 * viewer moved into the app still opens what it did. Null for any other hash.
 */
export function routeOfLegacyHash(hash: string): string | null {
    const legacy = /^#(battle|fleet)=(.*)$/s.exec(hash);
    return legacy === null ? null : `#/battle?${legacy[1]}=${legacy[2]}`;
}
