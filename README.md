# lu-o-lu.game

基于 **PixiJS 8 + TypeScript + Vite** 的 2D 俯视角动作小游戏。  
场上始终只有一名可操控角色（炸炸 / 冰冰），可 Tab 或点头像切换；远程攻击（炸弹 / 飞剑）、蜘蛛敌人、黑夜树林地图；关卡内 **G 上帝模式** 摆放树/怪并自动存草稿。

```bash
npm install
npm run dev      # 开发
npm run build    # tsc + vite build
npm run preview  # 预览产物
```

---

## 目录结构

```
src/
├── main.ts                 # 启动：Pixi Application、场景切换、存档
├── assets/                 # 预加载编排
├── data/                   # 存档、关卡地图定义、草稿
│   └── maps/               # LEVEL_1/2、walkMask、网格模板、编辑导出
├── entities/               # 角色 / 怪物 / 投射物 / 弹药（玩法实体）
│   ├── animals/            # 农场与野生动物（鸡猪牛马狼熊，按物种拆分）
│   └── CreatureEcology.ts  # 生态上下文类型（与 Spider 解耦）
├── systems/                # 跨实体规则：战斗、碰撞、收割、泥地、自然刷怪
│   ├── HarvestWorld.ts     # 草/树/掉落编排
│   ├── MudSpotField.ts     # 泥斑几何与合并
│   └── ecologySpawn.ts     # 自然孕育上限与标签
├── scenes/                 # 场景编排：主菜单、关卡、体型编辑、镜头
├── world/                  # 地图表现：草坪、松树 chunk、夜色
├── ui/                     # 屏幕 HUD（血条、弹药、暂停、切换、上帝面板）
├── input/                  # 键盘 + 边沿检测
├── data/                   # 存档、关卡、grass/tree/mud 数值配置
└── utils/                  # 数学、描边贴图、Debug 配置
public/assets/              # 运行时静态资源（角色图、炸弹、蜘蛛等）
```

| 目录 | 职责一句话 |
|------|------------|
| `entities` | **是什么、怎么表现、怎么打**（状态与意图在实体上） |
| `systems` | **世界如何结算**（弹体、命中、固体、角色池、收割、上帝摆放） |
| `scenes` | **这一帧谁先谁后**（输入、切换、驱动 update） |
| `world` | **地图长什么样**（不参与角色 AI） |
| `ui` | **屏幕叠层**（不写玩法规则） |
| `data` | **持久化与关卡数据** |

关卡相关 system（从 `LevelScene` 拆出）：

| 模块 | 职责 |
|------|------|
| `CharacterRoster` | 角色池挂载 / 上场 / Tab 切换冷却 |
| `HarvestWorld` | 可砍树、掉落、近战、进包 |
| `GodModeController` | G 模式摆放/擦除/出生点 + 草稿 |
| `EnemySpawner` / `enemyFactory` | 按地图刷怪 |
| `CombatSystem` | 投射物与命中 |

---

## 分层思路

核心原则：**意图在角色，事实在系统，编排在场景。**

```
┌─────────────────────────────────────────────────────────┐
│  LevelScene（编排）                                      │
│  输入 / 暂停 / 切换角色 / 驱动每帧 / 注入 Context         │
└────────────┬──────────────────────────┬─────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────────┐   ┌────────────────────────────┐
│  角色 / 蜘蛛（实体）    │   │  CombatSystem / Solid      │
│  出场、远程怎么打、     │   │  生成弹体、飞行、命中、销毁 │
│  弹药恢复、AI           │   │  脚底圆与树碰撞             │
└────────────────────────┘   └────────────────────────────┘
```

### 角色（entities）负责

- 自己的**出场演出**（空降残影 / 隐身爆弹等）
- **远程攻击玩法**（`tryRangedAttack`：扣弹、前摇、落点）
- **弹药与 HUD 模型**（`tickResources` / `getAmmoHud`）
- 贴图、朝向、手持飞剑动画、后仰姿态

角色通过注入的服务调用世界能力，**不** `import LevelScene`，也**不**自己维护 `bombs[]` 列表。

### CombatSystem 负责

远程投射物的**运行时**：

1. 屏幕点击 → 世界瞄准向量 → 交给 `player.tryRangedAttack`
2. `spawnBomb` / `spawnSpear`：生成并挂到 Y-sort 层
3. 每帧更新弹体、爆炸/命中蜘蛛、清理生命周期
4. 脚本能力：免费自动瞄准连射、多弹齐抛（出场等使用）

它**不**点名 `BombGirl` / `IceRanger`，**不**分别挂飞剑/炸药两个 HUD 回调，只回传统一的 `AmmoHudModel`。

### LevelScene 负责

- 挂载地图、刷怪、角色池（roster：场上只挂当前操控者）
- WASD / 点击 / Tab / 暂停 / 镜头
- 每帧：`knock` 抛物线 → solid → 出场 update → 角色 update → 蜘蛛 → `combat.update`
- 把 `EntranceContext`、镜头参数注入角色，不把具体出场/投掷逻辑写进场景

---

## 关键抽象

### 1. 出场（Entrance）

| 文件 | 作用 |
|------|------|
| `CharacterEntrance.ts` | `EntranceContext`、锁输入、通用战斗脚本类型 |
| `IceRanger` / `BombGirl` | 各自 `startEntrance` / `updateEntrance` / `entranceLocks` |
| 场景 | `player.startEntrance(ctx)`，按 `entranceLocks` 锁移动/攻击/切换 |

冰冰：空降 + 残影 + 落地环 + 免费三连矛。  
炸炸：隐身 → 三枚小弹 → 首爆显现。  
维护时改对应角色文件即可。

### 2. 资源与弹药 HUD

| 文件 | 作用 |
|------|------|
| `SpearAmmo` / `BombAmmo` | 上限、恢复、扣弹 |
| `CharacterResources.ts` | `AmmoHudModel`：`none` \| `spear` \| `bomb` |
| 基类 | `tickResources` / `getAmmoHud` |
| 场景 | `syncAmmoHud` / `applyAmmoHudModel`（只认 `kind`） |

场景**不** `instanceof` 角色来刷弹药。

### 3. 远程攻击（Ranged）

| 文件 | 作用 |
|------|------|
| `CharacterRanged.ts` | `RangedAim`、`RangedCombatServices` |
| 角色 | `tryRangedAttack(aim, combat)` |
| Combat | 瞄准换算 + `spawn*` + `onAmmoHudChanged` |

```
点击 → Combat.tryRangedAtScreen
         → 屏幕坐标转世界 aim
         → player.tryRangedAttack(aim, services)
              → services.spawnBomb / spawnSpear
              → services.notifyAmmoHud(model)
```

加第三角色远程：实现 `tryRangedAttack`（必要时扩展 `RangedCombatServices`），不必再给 Combat 加 `instanceof` 分支。

### 4. 世界坐标与纵深

- 实体持有 `worldX` / `worldY` + `knock`（击飞高度抛物线，见 `knockArc.ts`）
- `worldRoot` 负责镜头缩放/平移；`sortLayer.sortableChildren`，`zIndex ≈ 脚底 Y`
- 角色/怪/树 chunk/弹体都进 sortLayer；夜色只压在地面上，不盖角色

### 5. 碰撞

- `WorldActor`：`bodyR`（挤推）/ `hurtR`（受击）
- `SolidResolver`：玩家、蜘蛛、树区互挡
- 蜘蛛 AI 在 `Spider.ts`；咬中玩家后由场景扣血条（怪不直接改 HUD）

---

## 一帧大致流程（关卡）

```
LevelScene.update
  ├─ Esc 暂停 / Tab 切换 / 缩放快捷键
  ├─ 若暂停：只更新姿态与镜头，不推进战斗与资源
  ├─ stepKnockArc（击飞/空降高度）
  ├─ WASD（受 entranceLocks.move 约束）
  ├─ applyPlayerSolid
  ├─ player.updateEntrance
  ├─ player.update（走路晃动等）
  ├─ player.tickResources + syncAmmoHud
  ├─ spiders.update + solid + 咬击结算
  ├─ combat.update（弹体与命中）
  └─ sortDepth
```

---

## 角色与敌人

| 实体 | 文件 | 要点 |
|------|------|------|
| 炸炸 | `BombGirl.ts` | 炸药弹药、抛物线炸弹、出场三弹显现 |
| 冰冰 | `IceRanger.ts` | 飞剑弹药、手持矛动画、直线矛、空降出场 |
| 基类 | `PlayerCharacterBase.ts` | 贴图、朝向、晃动、击飞姿态、出场/远程/资源默认空实现 |
| 蜘蛛 | `Spider.ts` | 领地巡视 → 察觉追击 → 扑咬（AI 数值都在本文件） |
| 炸弹 | `BombProjectile.ts` | 飞行弧线、爆炸范围与伤害衰减 |
| 飞剑 | `SpearProjectile.ts` | 直线飞行、插地、命中伤害 |

角色缩放、默认出场角色等关卡常量见 `LevelScene` 顶部与存档 `lastCharacter`。

---

## 场景一览

| 场景 | 说明 |
|------|------|
| `MainScene` | 选关 / 进体型编辑 |
| `LevelScene` | 可玩关卡（核心编排） |
| `BodyEditScene` | 碰撞/受击体编辑 |
| `SceneManager` | 切换、resize、销毁旧场景 |

存档（`LocalSaveStore`）：上次场景、上次操控角色等。

---

## 操作（关卡内）

| 输入 | 作用 |
|------|------|
| WASD | 移动 |
| 鼠标点击 | 远程攻击（准星角色）；上帝模式下为摆放 |
| Tab / 右侧头像 | 切换角色 |
| Q / E | 特技 / 闪现（按角色实现） |
| R | 近战砍可交互树 |
| G | 上帝模式（摆放树/怪/出生点，自动草稿） |
| Esc | 暂停 |
| 滚轮 / `+` `-` | 缩放；`0` 复位；`F` 看全景 |

---

## 扩展指南（按目标找文件）

| 你想… | 优先改 |
|-------|--------|
| 新角色出场 | 新角色类里的 `startEntrance` 等 + roster 注册 |
| 新远程武器 | `tryRangedAttack` + 必要时 `spawnXxx` 服务 |
| 新弹药 HUD | `AmmoHudModel` 加 `kind` + `applyAmmoHudModel` + UI 组件 |
| 调蜘蛛数值 | `Spider.ts` 顶部 `AI` 常量 |
| 调炸弹/矛伤害射程 | `BombProjectile` / `SpearProjectile` 常量 |
| 新关卡布局 | `data/maps/` 或关卡内 G 上帝模式 |
| 碰撞手感 | `WorldActor` 半径、`SolidResolver`、`knockArc` |

**避免**：把角色专属演出或武器模式堆进 `LevelScene`；把飞剑/炸药特化 API 写进 `CombatSystemHooks`。

---

## 技术栈

- [PixiJS](https://pixijs.com/) v8 — 渲染与显示树  
- TypeScript — 严格类型  
- Vite — 开发与打包  

资源路径以 `/assets/...` 挂在 `public/assets` 下；角色预览图经 `outlineTexture` 烘焙描边后使用。
