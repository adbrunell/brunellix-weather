---
name: scap-integration
description: Habilidade completa para integrar, configurar e operar o motor de cálculo SCAP (Smart Computerized Airplane Performance) para aeronaves Embraer E-Jets E2, E-Jets E1 e ERJ via DLLs Fortran proprietárias. Use sempre que precisar configurar o ambiente, chamar as DLLs, processar resultados, depurar erros ou modificar parâmetros de cálculo.
---

# SKILL: SCAP — EM BRAER PERFORMANCE CALCULATION ENGINE

Esta habilidade cobre toda a integração com o SCAP (SM-001-A v1.22.1): desde o setup do ambiente, passando pela interface com DLLs Fortran via ctypes, até o fluxo completo de cálculo, tratamento de erros e validação.

---

## 1. VISÃO GERAL DO PROJETO

**SCAP (Smart Computerized Airplane Performance)** é uma calculadora de performance de decolagem e pouso para aeronaves Embraer.

### Arquitetura

```
OASYS/
├── OASYS v1.0.html          # Frontend (6 páginas: routes/airports/takeoff/aircraft/weather)
├── Scap/                    # Aplicação Python
│   ├── gui.py               # Servidor Flask (API :5000 — batch_stream, results, era5)
│   ├── worker.py            # Worker multiprocess (cópias isoladas da DLL)
│   ├── update.py            # Atualização do módulo SCAP (DLLs+bancos → data/)
│   ├── era5.py results_store.py
│   ├── core/                # Motor de cálculo
│   │   ├── config.py        # Aeronaves, motores, certificações, E2_DBS, paths
│   │   ├── dlls.py          # ScapDLL class — ctypes COMMON blocks + auto-discovery
│   │   ├── engine.py        # run_optimum_takeoff() + set_*_block() + CLI
│   │   └── param_defs.py    # Definições de parâmetros para o editor
│   ├── defaults/            # 6 JSONs: {E1,E2,ERJ}_{takeoff,landing}.json
│   └── data/                # DLLs + databases em runtime (+ module.json)
├── Database/                # Aircraft/ (presets JS), Airports/ (airports.js), Weather/era5/
└── run.bat                  # Launcher
```

### Três famílias de aeronaves

| Família | Modelos | Motores | DLL Bitness |
|---------|---------|---------|-------------|
| **E2** | E190-E2, E195-E2 | PW1919G, PW1921G, PW1922G, PW1923G, PW1923G-A | 64-bit (x64/ETLME2_v311_x64.dll) |
| **E1** | E170, E175, E190, E195 | CF34-8E, CF34-8E5, CF34-8E5A1, CF34-10E5/6/7 | 32-bit |
| **ERJ** | ERJ-135, ERJ-140, ERJ-145 | AE3007A, AE3007A1, AE3007A1P, AE3007A3 | 32-bit |

**IMPORTANTE**: E2 requer Python 64-bit. E1 e ERJ requerem Python 32-bit. Não misture.

---

## 2. SETUP DO AMBIENTE

### 2.1. Pré-requisitos

```powershell
pip install flask waitress openpyxl
```

### 2.2. DLLs e databases (já populados)

Os dados de runtime já estão em `Scap/data/` (E1/E2/ERJ × takeoff/landing com DLLs, runtimes e bancos). O instalador original (`SM-001-A v1.22.1/` + `setup.py`) foi movido para `_lixo/` na reestruturação — não é necessário para rodar.

**Atualizar para um novo módulo** (ex: `SM-001-A v1.23.x` extraído em qualquer pasta):

```powershell
python Scap/update.py --source "C:\caminho\SM-001-A v1.23.x" --dry-run   # confere
python Scap/update.py --source "C:\caminho\SM-001-A v1.23.x"             # instala (backup auto)
```

```
Scap/data/
├── DFORRT.DLL + msvcr120.dll   # Runtimes Fortran/MSVC (compartilhados)
├── E1/takeoff/   → DLL + 13 .DAT/.pdm da E1_Database
├── E1/landing/   → 2 DLLs + 13 .DAT/.pdm
├── E2/takeoff/   → ETLME2_v311.dll + x64/ (ETLME2_v311_x64.dll + .pdm/.DAT)
├── E2/landing/   → ELM170v108_OPLD.dll + x64/ (ETLME2_v311_x64.dll + .pdm/.DAT)
├── ERJ/takeoff/  → ETBALL_v719-2100.dll + .obj + .DAT
└── ERJ/landing/  → ELBALLv135.dll + .obj + .DAT
```

**CRÍTICO**: O subdiretório `x64/` em `E2/takeoff/` e `E2/landing/` deve conter **TANTO** a DLL 64-bit **QUANTO** todos os arquivos .pdm e .DAT do banco de dados. A variável MISCLA aponta para esta pasta.

### 2.3. Verificar estrutura

```powershell
# Verifique se todas as pastas existem
Get-ChildItem Scap/data/ -Directory
# Verifique se x64/ está populado
Get-ChildItem Scap/data/E2/takeoff/x64/
```

### 2.4. Iniciar servidor

```powershell
cd Scap
python gui.py
# → http://localhost:5000
```

Ou clique duas vezes em `run.bat`.

---

## 3. DLL INTERFACE (dlls.py)

### 3.1. ScapDLL class

```python
from core.dlls import ScapDLL

# Auto-seleciona 32 ou 64-bit baseado em sys.maxsize
scap = ScapDLL(aircraft_code="E2", phase="takeoff", data_dir="Scap/data/E2/takeoff")
```

### 3.2. DLL_DEFS — Mapeamento por aeronave/fase

```python
# Auto-discovery: as DLLs sao achadas por glob (pattern/pattern64 + prefer p/ desempate).
# Nova versao do modulo SCAP NAO exige editar este mapa.
DLL_DEFS = {
    "E2": {
        "takeoff": {
            "pattern": "ETLME2*.dll",          # 32-bit (raiz da pasta)
            "pattern64": "x64/ETLME2*_x64.dll",# 64-bit
            "subroutine": "ETME2",
            "blocks": {"tinpn": TINPN, "tinpa": TINPA, "toutn": TOUTN, "touta": TOUTA},
            # is_uppercase: False (padrão)
        },
        "landing": {
            "pattern": "ELM*.dll",
            "pattern64": "x64/ETLME2*_x64.dll",  # MESMA DLL: landing via ELME2
            "subroutine": "ELME2",
            "blocks": {"linpn": LINPN, "linpa": LINPA, "loutn": LOUTN, "louta": LOUTA},
        },
    },
    "E1": {
        "takeoff": {
            "pattern": "ETM*.dll",
            "prefer": None,
            "subroutine": "ETM170DLL",
            "blocks": {"TINPN": TINPN, "TINPA": TINPA, "TOUTN": TOUTN, "TOUTA": TOUTA},
            "is_uppercase": True,
        },
        "landing": {
            "pattern": "ELM*.dll",
            "prefer": "CAFM",   # desempata ELM170v122_CAFM-20050 vs ELM170v108_OPLD
            "subroutine": "ELM170DLL",
            "blocks": {"LINPN": LINPN, "LINPA": LINPA, "LOUTN": LOUTN, "LOUTA": LOUTA},
            "is_uppercase": True,
        },
    },
    "ERJ": {
        "takeoff": {
            "pattern": "ETBALL*.dll",
            "prefer": None,
            "subroutine": "ETBALLDLL",
            "blocks": {"TINPN": TINPN, "TINPA": TINPA, "TOUTN": TOUTN, "TOUTA": TOUTA},
            "is_uppercase": True,
        },
        "landing": { "pattern": "ELBALL*.dll", ... },
    },
}
```

> **Atenção (bug conhecido)**: `ETLME2*.dll` casa também com a DLL **32-bit** (`ETLME2_v311.dll`)
> se ela existir dentro de `x64/` — por isso o `pattern64` usa `*_x64.dll`. O `update.py` remove
> DLLs antigas/estranhas ao instalar; se sobrar lixo, apague os `*.dll` de família do `x64/`.

### 3.3. COMMON Blocks (ctypes Structures)

**Takeoff inputs:**
- `TINPA` — Texto: ACTYPE(20), ENGTYP(20), RATING(20), BRAKES(20), CERTIF(20), REVNBR(20), DATE(20), DBOPTI(20), ACMDBI(255), APTIDT(20), RWYNBR(20), COMENT(132×20), MISCLA(255), FDCFGI(20), CDLFIL(255)
- `TINPN` — Numérico: POPT(200), CONF(200), XMET(200), RWYD(200), OBSD(200), FPTD(200), UNIT(200), SPIA(200), SPIB(200), SPIC(200)

**Takeoff outputs:**
- `TOUTN` — CLIMIT(200), RWYSEG(200), FIRSEG(200), SECSEG(200), ACCSEG(200), FINSEG(200), OBSLIM(200), TRNDAT(200), SPOUTA(200)
- `TOUTA` — ERFLAG(20), ERRMSG(80×20), MMIDNT(20), MMDATE(20), ACMDBO(255), OUTMIS(80×20)

**Landing inputs:**
- `LINPA` — ACTYPL(20), ENGTYL(20), RATINL(20), BRAKEL(20), CERTIL(20), REVNBL(20), DATEL(20), DBOPTL(20), AMDBIL(255), APTIDL(20), RWYNBL(20), COMENL(132×20), MISCLL(255), FDCFGA(20), FDCFGL(20), CDLFLL(255), IFCFIL(255)
- `LINPN` — POPTL(200), CONFL(200), XMETL(200), RWYDL(200), UNITL(200), SPIAL(200), SPIBL(200), SPICL(200), IFCIN(200)

**Landing outputs:**
- `LOUTN` — CLIMIL(200), IFCNUM(200)
- `LOUTA` — ERFLAL(20), ERRMSL(80×20), MMIDNL(20), MMDATL(20), AMDBOL(255), OUTMIL(80×20), IFCSTR(80×200)

### 3.4. Naming Convention (CASE)

- **E2**: COMMON blocks em **lowercase** (`tinpn`, `tinpa`, `toutn`, `touta`, `linpn`, `linpa`, `loutn`, `louta`)
- **E1/ERJ**: COMMON blocks em **UPPERCASE** (`TINPN`, `TINPA`, `TOUTN`, `TOUTA`, etc.)

---

## 4. PADRÃO SENTINEL (CRÍTICO — NUNCA IGNORAR)

**Regra de ouro**: Todo elemento não utilizado em arrays numéricos deve ser `9.E20`.

```python
SENTINEL = 9.0E20  # ~8.9999998285e+20

# ⚠️ NUNCA faça isso:
arr = [0] * 200  # ERRADO — DLL rejeita com "must be 9.E20"

# ✅ SEMPRE faça isso (fill-all, then override):
for i in range(len(p.POPT)):
    p.POPT[i] = SENTINEL
# Depois sobrescreva os índices específicos:
p.POPT[0] = 1.0   # POPT(1) = calculation option
p.POPT[5] = 0.0   # POPT(6) = V1/VR choice
```

**Onde se aplica**: Todos os arrays de `TINPN`/`LINPN`: POPT, CONF, XMET, RWYD, OBSD, FPTD, UNIT, SPIA, SPIB, SPIC, POPTL, CONFL, XMETL, RWYDL, UNITL, SPIAL, SPIBL, SPICL, IFCIN.

**Implementação de referência** (`core/engine.py:set_num_block`):

```python
def set_num_block(scap, key, params):
    block = scap.blocks[key]
    for field_name, field_type in block._fields_:
        arr = getattr(block, field_name)
        # FILL ALL WITH SENTINEL
        for i in range(len(arr)):
            arr[i] = SENTINEL
        # OVERRIDE SPECIFIC
        if field_name in params:
            values = params[field_name]
            if isinstance(values, dict):
                for idx_str, v in values.items():
                    try:
                        idx = int(idx_str) - 1
                        if 0 <= idx < len(arr) and v is not None:
                            arr[idx] = float(v)
                    except (ValueError, IndexError):
                        pass
```

---

## 5. TEXT FIELDS (CHARACTER*20)

Todos os campos de texto nas COMMON blocks são **fixed-width CHARACTER*20**. Strings devem ser codificadas em ASCII e preenchidas com espaços.

```python
def pad(s, n=20):
    return s.encode() + b" " * (n - len(s))

t.ACTYPE = pad("E195-E2")    # → b"E195-E2            "
t.ENGTYP = pad("PW1921G")    # → b"PW1921G            "
```

**Campos de 255 caracteres** (ACMDBI, MISCLA, etc.):
```python
t.ACMDBI = b"CAFM-ADB-069.pdm;CAFM-EDB-015.pdm" + b" " * 222
```

---

## 6. MISCLA — DATABASE PATH (CRÍTICO PARA E2)

A DLL E2 precisa saber onde estão os arquivos .pdm/.DAT. O caminho é passado via campo `MISCLA` (takeoff) ou `MISCLL` (landing) no COMMON block de texto.

**Regra**: MISCLA deve apontar para a pasta `x64/` que contém **ambos** a DLL e os databases.

```python
dll_dir = os.path.join(data_dir, "x64")   # ex: Scap/data/E2/takeoff/x64
if os.path.exists(dll_dir):
    misc = (dll_dir + os.sep).encode()[:238]
    t.MISCLA = misc + b" " * (255 - len(misc))
```

**Verificação**: Os arquivos .pdm referenciados em ACMDBI DEVEM estar na pasta apontada por MISCLA.
- E195-E2: `CAFM-ADB-069.pdm;CAFM-EDB-015.pdm`
- E190-E2: `CAFM-ADB-070.pdm;CAFM-EDB-014.pdm`

---

## 7. FLUXO DE CÁLCULO COMPLETO (TAKEOFF)

### 7.1. Single calculation

```python
from core.dlls import ScapDLL, SENTINEL
from core.config import DATA_DIR
from core.engine import set_text_block, set_num_block

# 1. Carregar defaults
defaults = load_defaults("E2", "takeoff")

# 2. Inicializar DLL
data_dir = os.path.join(DATA_DIR, "E2", "takeoff")
scap = ScapDLL("E2", "takeoff", data_dir)
text_key = "tinpa"
num_key = "tinpn"

# 3. Set defaults
set_text_block(scap, text_key, defaults["tinpa"])
set_num_block(scap, num_key, defaults["tinpn"])

t = scap.blocks[text_key]
p = scap.blocks[num_key]

# 4. Override text fields
t.ACTYPE = pad("E195-E2")
t.ENGTYP = pad("PW1921G")
t.RATING = pad("TO-1")
t.CERTIF = pad("FAA")
t.RWYNBR = pad("07")

# 5. ACMDBI (model-dependent)
if ac_model == "E190-E2":
    t.ACMDBI = b"CAFM-ADB-070.pdm;CAFM-EDB-014.pdm" + b" " * 222
    t.DATE = b"15SEP2023;23AUG2021"
else:
    t.ACMDBI = b"CAFM-ADB-069.pdm;CAFM-EDB-015.pdm" + b" " * 222
    t.DATE = b"19SEP2023;23AUG2021"

# 6. MISCLA path
dll_dir = os.path.join(data_dir, "x64")
if os.path.exists(dll_dir):
    misc = (dll_dir + os.sep).encode()[:238]
    t.MISCLA = misc + b" " * (255 - len(misc))

# 7. Override numeric fields
p.XMET[5] = 25.0      # OAT
p.XMET[3] = 1.0       # QNH mode
p.XMET[4] = 1013.25   # QNH
p.XMET[1] = 0.0       # wind
p.RWYD[0] = 0.0       # elevation
p.RWYD[1] = 4000.0    # TORA
p.RWYD[2] = 4000.0    # TODA
p.RWYD[3] = 4000.0    # ASDA
p.POPT[13] = 0.0      # surface (dry)

# 8. Set flap
p.CONF[2] = 3.0       # flap 3
p.POPT[6] = 2.0       # fixed V2/VS
p.POPT[7] = 1.18      # V2/VS ratio

# 9. Run
try:
    scap.run()
except Exception as e:
    print(f"Calculation error: {e}")

# 10. Read results
ta = scap.blocks["touta"]
tn = scap.blocks["toutn"]

flag = ta.ERFLAG.decode() if isinstance(ta.ERFLAG, bytes) else ta.ERFLAG
if flag == "A":
    mtow = tn.CLIMIT[0]           # MTOW
    lim_code = int(tn.CLIMIT[1])  # Limitation code
    print(f"MTOW = {mtow:.2f} kg, Code = {lim_code}")
else:
    for i in range(20):
        msg = ta.ERRMSG[i].value.decode().strip()
        if msg and msg != "0":
            print(f"Error {i}: {msg}")
```

### 7.2. Optimum Flap Scan

O algoritmo testa flaps 4→1 (e go-around flaps) e escolhe o maior MTOW.

```python
from core.engine import run_optimum_takeoff

best = run_optimum_takeoff(scap, text_key, num_key, alt_goaround_flap=5)
# Retorna: { "mtow": float, "flap": int, "v2vs": float,
#            "goaround_flap": int, "output": dict, "lim_code": int,
#            "flap_results": [{"flap":.., "ga":.., "mtow":"..", "best":bool}] }

if best["flap"]:
    print(f"Best: Flap {best['flap']}, V2/VS={best['v2vs']}, MTOW={best['mtow']:.2f}")
```

**V2/VS ratios por flap:**

```python
E2_V2VS = {
    "E190-E2": {1: 1.18, 2: 1.22, 3: 1.18, 4: 1.17},
    "E195-E2": {1: 1.18, 2: 1.22, 3: 1.18, 4: 1.18},
}
```

**Algoritmo**: Testa flaps [1, 2, 3, 4]. Para cada flap, testa go-around flaps [alt_goaround_flap, 6]. Escolhe maior MTOW. Para cedo se MTOW ≥ max (62500 E195, 60000 E190) ou se MTOW cai por 2 flaps consecutivos.

---

## 8. FLUXO DE CÁLCULO (LANDING)

```python
# 1. Inicializar
scap = ScapDLL("E2", "landing", data_dir)
text_key = "linpa"
num_key = "linpn"

# 2. Set defaults + overrides
set_text_block(scap, text_key, defaults["linpa"])
set_num_block(scap, num_key, defaults["linpn"])

t = scap.blocks[text_key]
p = scap.blocks[num_key]

t.ACTYPL = pad("E195-E2")
t.ENGTYL = pad("PW1923G")
t.RATINL = pad("GA")       # ou "" para normal
t.CERTIL = pad("FAA")

# 3. Regras específicas de landing
p.POPTL[1] = 1.0    # POPTL(1)=1: Landing Distances (Given Weight)
p.CONFL[1] = 1.0    # CONFL(1)=1: Selected configuration
p.CONFL[5] = 6.0    # CONFL(5)=6: Flap FULL (ou 5)
p.CONFL[30] = 1.0   # CONFL(30)=1: Manual CAT-I (OBRIGATÓRIO)
p.POPTL[28] = 0.0   # POPTL(28)=0: Drag index (sentinel causa erro)
p.POPTL[36] = 0.0   # POPTL(36)=0: Dispatch/RLD
p.POPTL[37] = 1.0   # POPTL(37)=1: Wet check

# 4. Condições
p.XMETL[0] = 25.0   # OAT
p.XMETL[3] = 1.0    # QNH mode
p.XMETL[4] = 1013.25
p.XMETL[1] = 0.0    # wind
p.RWYDL[0] = 0.0    # elevation
p.RWYDL[1] = 2000.0 # LDA

# 5. Rodar
scap.run()

# 6. Ler resultados
ta = scap.blocks["louta"]
tn = scap.blocks["loutn"]
flag = ta.ERFLAL.decode() if isinstance(ta.ERFLAL, bytes) else ta.ERFLAL

if flag == "A":
    mlw = tn.CLIMIL[0]   # Landing Weight Limit
    lim = tn.CLIMIL[1]   # Limitation code
    dist = tn.CLIMIL[2]  # Landing Distance
    vref = tn.CLIMIL[3]  # Vref
```

---

## 9. OBSTÁCULOS (OBSD)

### Layout do array OBSD

```
OBSD[0]        = número de obstáculos (count, 0-30)
OBSD[1]        = datum flag: 0 = início da TORA, 1 = fim da TORA
OBSD[2 + 3*i]  = distância do obstáculo i (metros)
OBSD[3 + 3*i]  = altura do obstáculo i (pés)
OBSD[4 + 3*i]  = offset lateral (metros)
Todos os outros = SENTINEL (9.E20)
```

### Implementação

```python
obs_list = params.get("obstacles", [])
if obs_list:
    # DLL valida: distância ≥ TORA + 1000m (limitação de certificação)
    tora = float(params.get("rwy_2", 0))
    min_dist = max(tora + 1000, 0)
    valid = [o for o in obs_list if float(o.get("dist", 0)) >= min_dist]
    n = min(len(valid), 30)
    if n > 0:
        # Fill all with sentinel first
        for i in range(len(p.OBSD)):
            p.OBSD[i] = SENTINEL
        p.OBSD[0] = float(n)
        p.OBSD[1] = 0.0
        for i in range(n):
            p.OBSD[2 + 3 * i] = float(valid[i].get("dist", 0))
            p.OBSD[3 + 3 * i] = float(valid[i].get("height", 0))
```

**Nota**: A DLL rejeita obstáculos com distância < TORA + ~1000m. Isto é uma limitação de certificação, não um bug.

---

## 10. THREAD SAFETY E PARALELISMO

### Multiprocessing (batch_stream)

O cálculo roda em `worker.py:run_job` — cada processo tem a própria DLL e seus caches
(`_scap_cache`, `_defaults_cache`). O `gui.py` não toca na DLL diretamente:

```python
from concurrent.futures import ProcessPoolExecutor, as_completed
from worker import run_job

pool = ProcessPoolExecutor(max_workers=os.cpu_count())
fut_map = {pool.submit(run_job, job): i for i, job in enumerate(jobs)}
for future in as_completed(fut_map):
    res = future.result()            # Cada processo tem sua própria DLL
    yield json.dumps({"result": res}) + "\n"
```

**Worker**: `worker.py` é um módulo autocontido que importa `dlls`, `config`, `scap` de forma independente. Mantém seus próprios caches (`_scap_cache`, `_defaults_cache`). Não precisa de `DLL_LOCK`.

### Performance esperada (E2 takeoff, optimum flap, 8-core)

| Jobs | Tempo | Por job |
|------|-------|---------|
| 1 | 0.4s | 400ms |
| 100 | 4.5s | 45ms |
| 500 | 22s | 44ms |

---

## 11. PARÂMETROS — REFERÊNCIA COMPLETA

### 11.1. POPT — Performance Options (Takeoff)

| Índice | Descrição | Tipo | Valores |
|--------|-----------|------|---------|
| 1 | Calculation option | select | 1=Airport Analysis, 2=Distances Given Weight |
| 5 | V1/VR choice | select | 0=Optimum, 2=Balanced, 3=Min V1, 4=Max V1, 7=Fixed V1 |
| 6 | Fixed V1 value (kt) | float | - |
| 7 | V2/VS choice | select | 2=Fixed V2/VS com VMU/VMC |
| 8 | V2/VS ratio | float | Flap 1:1.18, 2:1.22, 3:1.18, 4:1.18(E195)/1.17(E190) |
| 10 | Oei obstacle clearance height (ft) | float | Mínimo 35 |
| 11 | Takeoff flight path type | select | 0=2nd Seg, 3=Extended 2nd, 4=2nd+Final |
| 12 | Alignment allowance TORA/TODA (m) | float | 9.E20 se POPT(53)≠0 |
| 13 | Alignment allowance ASDA (m) | float | 9.E20 se POPT(53)≠0 |
| 14 | Surface condition | select | 0=Dry, 1=Wet, 2=Water, 3=Slush, 4=Snow, 5=Dry Snow, 6=Wet Snow, 7=Ice |
| 15 | Contamination depth (mm) | float | Range 1-95.25 |
| 16 | Braking friction coefficient | select | 6=Certification values |
| 18 | Gross level-off flag | select | 1=Fixed, 2=Min only |
| 19 | Gross level-off height (ft) | float | Mínimo 400 |
| 20 | Trace flag | select | 0=No trace, 1=Trace to file |
| 23 | Max computational weight flag | select | 0=CAFM limits, 1=Selected |
| 24 | Selected weight (kg) | float | E190: 30000-60000, E195: 30000-62500 |
| 26 | Takeoff thrust time limit (min) | float | - |
| 30 | CG Envelope | select | 0=Standard, 1=Alt 1, 2=Alt 2 |
| 33 | 2nd segment gradient flag | select | 0=Normal, 1=Selected |
| 34 | 2nd segment gradient (%) | float | - |
| 35 | Drag index | float | 0-1500 |
| 47 | Start of takeoff procedure | select | 0=Static, 1=60% N1, 2=40% N1, 3=Rolling |
| 49 | Dry check flag | select | 0=Yes, 1=No |
| 53 | Alignment allowance flag | select | 0=Use POPT(12/13), 1=Entry Angle, 2=Both |
| 57 | Assumed temperature flag | select | 0=Not requested, 1=Requested |
| 58 | Max assumed temp procedure | select | 0=Exact, 1=Highest integer |

### 11.2. CONF — Configuration (Takeoff)

| Índice | Descrição | Tipo | Valores |
|--------|-----------|------|---------|
| 1 | Slat/Flap choice | select | 1=Selected |
| 3 | Slat/Flap position TO | select | 1=Flap 1, 2=Flap 2, 3=Flap 3, 4=Flap 4 |
| 4 | ECS | select | 1=ON, 2=OFF |
| 5 | Anti-icing | select | 0=OFF, 1=ENG, 3=ALL |
| 8 | Reversers | select | 0=All inop, 1=All operative, 2=One inop |
| 13 | Auto brakes | select | 1=OFF |
| 15 | Tire type | select | 2=Radial |
| 21 | ATTCS flag | select | 0=ATTCS ON, 1=ATTCS OFF (PW1922G requer OFF c/ TO-1) |
| 58 | Landing flap pos | select | 5=Flap 5, 6=FULL |

### 11.3. XMET — Meteorological (Takeoff)

| Índice | Descrição | Tipo |
|--------|-----------|------|
| 1 | Temperature / Assumed temp (ºC). 9.E20 = use XMET(6) | float |
| 2 | Wind component (kt). Headwind +, Tailwind - | float |
| 4 | Altitude flag | select: 0=Press Alt, 1=QNH, 2=QFE |
| 5 | Altitude value (QNH em hPa, QFE em hPa, alt em ft) | float |
| 6 | OAT (ºC). 9.E20 = use XMET(1) | float |

### 11.4. RWYD — Runway Data (Takeoff)

| Índice | Descrição | Tipo |
|--------|-----------|------|
| 1 | Elevation (ft) | float |
| 2 | RWY length data flag | select: 0=TORA/TODA/ASDA, 1=TORA/Clearway/Stopway |
| 3 | TORA (m) | float 500-6000 |
| 4 | TODA (m) | float |
| 5 | ASDA (m) | float |
| 6 | Slope TODA (%) | float -2.0 a +2.0 |
| 7 | Slope ASDA (%) | float -2.0 a +2.0 |
| 8 | Surface | select: 0=Normal, 2=Grooved/Porous |
| 12 | Entry angle (degrees) | float |

### 11.5. UNIT — Units (Takeoff)

| Índice | Descrição | Valores |
|--------|-----------|---------|
| 1 | Temperature | 0=Celsius, 1=Fahrenheit, 2=ISA dev C, 3=ISA dev F |
| 2 | Time | 0=Seconds, 1=Minutes |
| 3 | Horizontal dist | 0=Meters, 1=Feet |
| 4 | **Vertical dist** | **1=Feet (OBRIGATÓRIO)** |
| 5 | Contaminant depth | 0=mm, 1=Inches |
| 6 | Pressure | 0=mbar, 1=inHg |
| 8 | Weight | 0=kg, 1=lb, 2=kN |
| 9 | Speed | 0=m/s, 1=ft/min, **2=Knots** |
| 10 | Energy | 0=Joules, 1=lb·ft, 2=% max, 3=kgf·m |

### 11.6. POPTL — Performance Options (Landing)

| Índice | Descrição | Valores |
|--------|-----------|---------|
| 1 | Calculation option | 0=Limit Weights, 1=Dist Given Weight |
| 2 | Surface | 0=Dry, 1=Wet, ..., 11=Opld |
| 4 | Braking friction | 6=Cert values |
| 5 | Trace | 0=No, 1=Yes |
| 8 | Selected weight flag | 0=CAFM limit, 1=Selected |
| 9 | Selected weight (kg) | float |
| 17 | Approach climb gradient flag | 0=Normal, 1=Selected |
| 21 | Landing climb gradient flag | 0=Normal, 1=Selected |
| 28 | **Drag index** | **0 (sentinel causa erro)** |
| 36 | LD calc mode | 0=Dispatch/RLD |
| 37 | Wet check | 0=No, 1=Yes |

### 11.7. CONFL — Configuration (Landing)

| Índice | Descrição | Valores |
|--------|-----------|---------|
| 1 | Slat/Flap choice | 1=Selected |
| 5 | Landing flap | 5=Flap 5, 6=FULL |
| 7 | Anti-icing | 0=OFF, 3=ENG+WING |
| 10 | Thrust reverser | 0=All inop, 1=All op, 2=One inop |
| 15 | Spoilers | 0=OFF, 1=ON |
| 16 | Auto brakes choice | 0=OFF, 1=Selected, 2=Max |
| 17 | Auto brakes setting | 0=Min, 1=Inter, 2=Max |
| 19 | Tire type | 2=Radial |
| **30** | **Landing category** | **1=Manual CAT-I (OBRIGATÓRIO)** |
| 34 | In-flight icing | 0=No, 1=Yes |

---

## 12. OUTPUT NAMES (para display)

### CLIMIT — Limiting Weights
1=MTOW (kg), 2=Limitation Code, 3=OEI TOD (m), 4=V2/VS, 5=V2 (kt), 6=VR (kt), 7=Min V1 (kt), 8=Lim Code Min V1, 10=TO Run Min V1 (m), 13=Max V1 (kt), 19=Opt V1 (kt), 25=AEO TO Run (m)

### Códigos de Limitação
1=Structural, 2=AEO TOD, 3=Field, 10=Tire Speed, 14=1st Segment, 15=2nd Segment, 18=Final Segment, 19=Obstacle, 51=Go-around

### Leitura do limitation code
O limitation code está nas posições [2, 8, 14, 20] do CLIMIT (1-indexed). A primeira posição não-sentinel é o código real:

```python
lim = 0
climit = [tn.CLIMIT[i] for i in range(30)]
for i, v in enumerate(climit):
    if abs(v - 9e20) > 1e15 and (i + 1) in [2, 8, 14, 20]:
        lim = int(v) if abs(v) < 1000 else 0
        break
```

### CLIMIL — Landing Limits
1=Landing Weight Limit (kg), 2=Limitation Code, 3=Landing Distance (m), 4=Vref (kt), 5=Approach Climb Limit (kg), 6=Landing Climb Limit (kg)

---

## 13. ERROR HANDLING

### Fluxo de validação da DLL

A DLL valida na seguinte ordem. Corrija um erro de cada vez — cada correção revela o próximo:

1. Text fields (preenchimento, padding)
2. UNIT arrays (sentinel check)
3. POPT sentinel check
4. CONF sentinel check
5. Values (range, consistência)
6. Calculation

### Leitura de erros

```python
ta = scap.blocks["touta"]  # ou "louta" para landing
flag = ta.ERFLAG if phase == "takeoff" else ta.ERFLAL
if isinstance(flag, bytes):
    flag = flag.decode()

if flag == "A":
    # Sucesso
    mtow = tn.CLIMIT[0]
else:
    # Erro — ler mensagens
    err_arr = ta.ERRMSG if phase == "takeoff" else ta.ERRMSL
    for i in range(20):
        msg = err_arr[i].value.decode().strip()
        if msg and msg != "0":
            print(f"Error {i}: {msg}")
```

### Erros comuns

| Sintoma | Causa provável |
|---------|---------------|
| "must be 9.E20" | Sentinel loop não executado (fill-all faltando) |
| ERFLAG diferente de 'A' sem mensagens | Validação de database — verificar ACMDBO |
| "Calculation error" após validação | DB version mismatch com DLL |
| Resultados zerados ou estranhos | MISCLA apontando para pasta errada |
| DLL não encontrada | Python bitness incorreto (32 vs 64) |

### Debug

```python
# Verificar databases carregados
print(ta.ACMDBO.decode())  # → "CAFM-ADB-069.pdm;CAFM-EDB-015.pdm"

# Verificar sentinel
print(p.POPT[1])  # Deve ser 9e20 se não usado

# Testar worker diretamente
from worker import run_job
res = run_job({"phase":"takeoff", "aircraft":"E195-E2", "engine":"PW1921G", ...})
```

---

## 14. CHECKLIST DE TESTES E VALIDAÇÃO

### Pré-requisitos
- [ ] `Scap/data/` populado com todas as 6 subpastas (E1/E2/ERJ × takeoff/landing) — já está no pacote; `setup.py`/`SM-001-A` foram movidos para `_lixo/`
- [ ] `E2/takeoff/x64/` e `E2/landing/x64/` contêm DLL + .pdm + .DAT (o MISCLA aponta para `x64/`)
- [ ] Python bitness correto (64-bit para E2, 32-bit para E1/ERJ)
- [ ] Dependências instaladas: `flask`, `waitress`

### Testes funcionais
- [ ] **CLI**: `python Scap/core/engine.py` → selecionar E2/E195-E2/PW1921G/TAKEOFF/TO-1/FAA/Optimum → **deve rodar**
- [ ] **Worker isolado**: `from worker import run_job; run_job({"phase":"takeoff","aircraft":"E195-E2","engine":"PW1921G"})`
- [ ] **Servidor**: `python Scap/gui.py` → `http://localhost:5000/api/health`
- [ ] **Batch stream**: POST `/api/batch_stream` com 10+ jobs
- [ ] **Landing**: job em `/api/batch_stream` com `{"phase":"landing","aircraft":"E195-E2","engine":"PW1923G"}`

### Combinações verificadas

| Aircraft | Engine | Fase | Nota |
|----------|--------|------|------|
| E195-E2 | PW1923G | Takeoff | ✅ |
| E195-E2 | PW1921G | Takeoff | ✅ (trace validado em TRACE_TOF.txt) |
| E190-E2 | PW1919G | Takeoff | ✅ |
| E190-E2 | PW1922G | Takeoff | ⚠️ Requer CONF(21)=1 (ATTCS OFF) |
| E195-E2 | PW1923G | Landing | ✅ (MLW 50000 kg) |

### Casos de erro conhecidos
- [ ] PW1922G + TO-1: **deve** falhar se CONF(21)≠1 (ATTCS OFF obrigatório)
- [ ] Obstáculo com dist < TORA+1000m: **deve** ser ignorado (limitação de certificação)
- [ ] Sentinel não preenchido: **deve** retornar "must be 9.E20"

---

## 15. PARÂMETROS ESPECIAIS POR MODELO

### E190-E2 vs E195-E2

| Parâmetro | E190-E2 | E195-E2 |
|-----------|---------|---------|
| ACMDBI | CAFM-ADB-070.pdm;CAFM-EDB-014.pdm | CAFM-ADB-069.pdm;CAFM-EDB-015.pdm |
| DATE | 15SEP2023;23AUG2021 | 19SEP2023;23AUG2021 |
| MTOW max | 60000 kg | 62500 kg |
| V2/VS Flap 4 | 1.17 | 1.18 |

### PW1922G (E190-E2)
- Único rating disponível: TO-1
- **Requer** `CONF[20] = 1.0` (ATTCS OFF, índice 21 em 1-based)

---

## 16. FLUXO COMPLETO (API — gui.py)

O `gui.py` é a camada HTTP sobre `worker.py` (pool de processos), `results_store.py` e `era5.py`:

```
POST /api/batch_stream     → lote paralelo (NDJSON streaming) — calcula via worker.run_job
POST /api/results/check    → consulta cache SQLite por sig (skip inteligente)
POST /api/results/store    → grava resultados no SQLite
GET  /api/era5/{meta,point,series,design} + POST /api/era5/fill → clima
GET  /api/health           → status
OPTIONS *                  → CORS (frontend file://)
```

**Removidos** (web UI antigo, em `_lixo`): rotas de página (`/`, `/takeoff`, `/landing`, `/spreadsheet`, `/setup`), `/api/airports`, `/api/airport/<icao>`, `/api/calculate`, `/api/batch`, `/api/export`, `/api/params/*` e `templates/`.

**Fluxo interno** (agora em `worker.py:run_job`):
1. Carrega defaults cacheados (`_defaults_cache`)
2. Carrega DLL cacheadas (`_scap_cache`) — cada processo mantém sua cópia
3. Aplica defaults nos COMMON blocks
4. Override com parâmetros da request
5. Se optimum flap → `run_optimum_takeoff()`, senão set flap direto
6. `scap.run()`
7. Parse resultado: ERFLAG='A' → extrai outputs, senão → coleta ERRMSG
8. Formata resposta com OUTPUT_ITEM_NAMES

---

## 17. DEPLOY / EXECUÇÃO

### Desenvolvimento

```powershell
cd Scap
python gui.py
# Local: http://localhost:5000
```

### Produção

O servidor já usa Waitress (production WSGI) com 8 threads:
```python
serve(app, host="0.0.0.0", port=5000, threads=8)
```

### Alternativa — CLI

```powershell
python Scap/core/engine.py
# Menu interativo: selecione aircraft → engine → phase → rating → cert → flap mode
```

---

**FIM DA SKILL** — Consulte esta documentação sempre que precisar integrar ou modificar o motor de cálculo SCAP.
