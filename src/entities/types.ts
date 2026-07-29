/** 可选用的玩家角色 id（新增角色时追加此项，并补 BODY_PROFILES / bodyEditCatalog） */
export const CHARACTER_IDS = ['bomb-girl', 'ice-ranger'] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];
