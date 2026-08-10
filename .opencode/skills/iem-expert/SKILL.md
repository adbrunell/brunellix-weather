---
name: iem-expert
description: Habilidade estado da arte para integrar, consultar e extrair dados meteorológicos históricos de aeroportos do Iowa Environmental Mesonet (IEM). Cobre ASOS/AWOS/METAR, TAF, PIREP, Wind Rose, current conditions, metadata de redes/estações e todos os serviços JSON/CGI da plataforma. Use sempre que precisar buscar dados meteorológicos históricos ou atuais de aeroportos via IEM.
---

# SKILL: IEM — IOWA ENVIRONMENTAL MESONET EXPERT

Habilidade de especialista máximo na plataforma IEM (Iowa Environmental Mesonet) da Iowa State University. Cobre toda a arquitetura de serviços, APIs, parâmetros, limites, boas práticas e exemplos de código para consumo de dados meteorológicos de aeroportos.

---

## 1. VISÃO GERAL

**Iowa Environmental Mesonet (IEM)** é um sistema de coleta, processamento e distribuição de dados ambientais mantido pelo Department of Agronomy da Iowa State University. O site agrega dados de milhares de estações meteorológicas globalmente.

### Fontes de Dados

| Fonte | Descrição |
|-------|-----------|
| **Unidata IDD** | Feed satelital NOAA (NOAAPort) — dados em tempo real |
| **NCEI ISD** | Integrated Surface Database — arquivo histórico oficial |
| **MADIS** | 5-minute ASOS / High Frequency METAR |
| **NCEI GHCNh** | Global Historical Climatology Network Hourly |

### Cobertura

- **Espacial**: Mundial (~300+ redes ASOS por país/estado)
- **Temporal**: 1900 até presente
- **Atualização**: A cada 10 minutos (dados real-time)
- **Formatos**: CSV, TSV, JSON, GeoJSON, Excel

### Código-Fonte

- https://github.com/akrherz/iem (backend principal, CGI services)
- https://github.com/akrherz/iem-web-services (API v1 FastAPI)

---

## 2. ARQUITETURA DE SERVIÇOS

O IEM expõe dados através de 4 camadas distintas de serviços:

### 2.1. CGI Bulk Data Services (`/cgi-bin/request/`)

Downloads pesados, CSV/TSV, rate-limited. Backend em Python (pylib/iemweb).

| Serviço | Arquivo | Uso Principal |
|---------|---------|---------------|
| **ASOS/METAR** | `asos.py` | Observações meteorológicas horárias de aeroportos |
| **ASOS 1-Minuto** | `asos1min.py` | Dados de 1 em 1 minuto (US apenas, 2000-) |
| **TAF** | `taf.py` | Previsões de aeródromo (Terminal Aerodrome Forecast) |
| **Daily Summaries** | `daily.py` | Resumos diários computados pelo IEM |
| **PIREP** | `gis/pireps.py` | Relatórios de piloto (turbulência, gelo, etc.) |
| **METARs** | `metars.py` | METARs puros (texto) |
| **Wind Rose** | `mywindrose.py` | Gerador de rosas dos ventos |

### 2.2. JSON/GeoJSON Services (`/json/`, `/geojson/`)

Serviços leves, sub-second, para metadata e dados pontuais.

| Serviço | Arquivo | Uso Principal |
|---------|---------|---------------|
| **Current Conditions** | `json/current.py` | Última observação de uma estação |
| **Network Metadata** | `json/network.py` | Metadados de uma rede (JSON) |
| **Network GeoJSON** | `geojson/network.py` | Rede em formato GeoJSON |
| **Station Neighbors** | `geojson/station_neighbors.py` | Estações próximas a um ponto |
| **Reference Data** | `json/reference.py` | Dados de referência do pyIEM |

### 2.3. API v1 (`/api/1/`)

API moderna em FastAPI com JSON Table Schema. Swagger em `/api/1/docs`. Código em `iem-web-services`.

### 2.4. OGC Services (`/ogc/`)

Padrões Open Geospatial Consortium (WMS, WFS, etc.).

---

## 3. NOMENCLATURA DE REDES E ESTAÇÕES

### 3.1. Padrão de Nomes de Rede

```
{UF}_ASOS      → Estados dos EUA    (ex: IA_ASOS, TX_ASOS, CA_ASOS)
{PAIS}__ASOS   → Países             (ex: BR__ASOS, DE__ASOS, JP__ASOS)
{AZOS}         → Global — todas as redes ASOS combinadas
```

**ATENÇÃO**: Países usam **duplo underscore** (`__`). Ex: `BR__ASOS` (Brasil), `DE__ASOS` (Alemanha).

Redes não-ASOS importantes:
- `{UF}_COOP` — NWS COOP (dados diários de clima)
- `{UF}_DCP` — Hydrological data
- `{UF}_RWIS` — Roadway weather
- `ISUSM` — Iowa State Soil Moisture
- `USCRN` — US Climate Reference Network

### 3.2. Como Descobrir Estações de uma Rede

**Método 1 — GeoJSON de rede** (recomendado):

```
GET https://mesonet.agron.iastate.edu/geojson/network/{NETWORK}.geojson
```

Retorna GeoJSON com `features[].properties.sid` (station ID), coordenadas, elevação, datas.

**Método 2 — JSON metadata**:

```
GET https://mesonet.agron.iastate.edu/json/network.py?network={NETWORK}
```

**Método 3 — CSV de todas as redes globais**:

```
GET https://mesonet.agron.iastate.edu/sites/networks.php?special=allasos&format=csv&nohtml
```

**Método 4 — Página web de localização**:

```
GET https://mesonet.agron.iastate.edu/sites/locate.php?network={NETWORK}
```

### 3.3. Exemplo: Descobrir estações do Brasil

```javascript
const resp = await fetch(
  'https://mesonet.agron.iastate.edu/geojson/network/BR__ASOS.geojson'
);
const geo = await resp.json();
const stations = geo.features.map(f => ({
  id: f.properties.sid,
  name: f.properties.sname,
  lat: f.geometry.coordinates[1],
  lon: f.geometry.coordinates[0],
  elev_m: f.properties.elevation,
  online: f.properties.online
}));
```

---

## 4. API PRIMÁRIA: ASOS/METAR (`/cgi-bin/request/asos.py`)

Endpoint principal para dados meteorológicos históricos de aeroportos. Documentação oficial: `?help`.

### 4.1. URL Base

```
https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py
```

**IMPORTANTE**: Prefira HTTP (`http://`) se houver problemas com certificados SSL Lets Encrypt em ambientes restritos.

### 4.2. Parâmetros Completos

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `data` | array | Não (default: all) | Colunas: `tmpf`, `dwpf`, `relh`, `drct`, `sknt`, `p01i`, `alti`, `mslp`, `vsby`, `gust`, `skyc1`, `skyc2`, `skyc3`, `skyc4`, `skyl1`, `skyl2`, `skyl3`, `skyl4`, `wxcodes`, `ice_accretion_1hr`, `ice_accretion_3hr`, `ice_accretion_6hr`, `peak_wind_gust`, `peak_wind_drct`, `peak_wind_time`, `feel`, `metar`, `snowdepth` |
| `station` | array | Não | ICAO code (ex: `SBGL`, `KJFK`). Múltiplos: `&station=A&station=B` ou `station=A,B` |
| `network` | array | Não | Rede IEM (ex: `BR__ASOS`, `IA_ASOS`). Múltiplos: `&network=A&network=B` |
| `sts` | string | Não* | Start time ISO: `2024-01-01T00:00:00Z` |
| `ets` | string | Não* | End time ISO: `2024-01-31T23:59:59Z` |
| `year1` | int | Não* | Ano inicial (alternativa a `sts`) |
| `month1` | int | Não* | Mês inicial |
| `day1` | int | Não* | Dia inicial |
| `hour1` | int | Não | Hora inicial (default: 0) |
| `minute1` | int | Não | Minuto inicial (default: 0) |
| `year2` | int | Não* | Ano final (alternativa a `ets`) |
| `month2` | int | Não* | Mês final |
| `day2` | int | Não* | Dia final |
| `hour2` | int | Não | Hora final (default: 0) |
| `minute2` | int | Não | Minuto final (default: 0) |
| `hours` | int | Não | Últimas N horas (máx 24 sem stations) |
| `tz` | string | Não | Timezone IANA (default: `UTC`). Ex: `America/Sao_Paulo`, `Etc/UTC` |
| `format` | string | Não | `onlycomma` (CSV, default), `tdf` (tab-delimited) |
| `latlon` | boolean | Não | `yes` para incluir lat/lon |
| `elev` | boolean | Não | `yes` para incluir elevação (m) |
| `missing` | string | Não | Representação de missing: `M` (default), `null`, `empty` |
| `trace` | string | Não | Representação de trace: `0.0001` (default), `null`, `empty`, `T` |
| `report_type` | array | Não | `1`=HFMETAR/5min, `3`=Routine, `4`=Specials. Default: todos |
| `direct` | boolean | Não | `yes` para download direto como arquivo |
| `nometa` | boolean | Não | `yes` para omitir cabeçalhos de coluna |

*\* `sts`/`ets` OU `year1`/`month1`/`day1`/`year2`/`month2`/`day2` OU `hours` são necessários para definir o período.*

### 4.3. Colunas de Dados Disponíveis

| Coluna | Descrição | Unidade |
|--------|-----------|---------|
| `station` | Código ICAO da estação (3-4 caracteres) | — |
| `valid` | Timestamp da observação (UTC ou tz selecionada) | ISO 8601 |
| `tmpf` | Air Temperature | Fahrenheit |
| `dwpf` | Dew Point Temperature | Fahrenheit |
| `relh` | Relative Humidity | % |
| `drct` | Wind Direction (from true north) | degrees |
| `sknt` | Wind Speed | knots |
| `p01i` | 1-hour Precipitation | inches |
| `alti` | Pressure Altimeter | inches Hg |
| `mslp` | Sea Level Pressure | millibar |
| `vsby` | Visibility | miles |
| `gust` | Wind Gust | knots |
| `skyc1` | Sky Level 1 Coverage | código |
| `skyc2` | Sky Level 2 Coverage | código |
| `skyc3` | Sky Level 3 Coverage | código |
| `skyc4` | Sky Level 4 Coverage | código |
| `skyl1` | Sky Level 1 Altitude | feet |
| `skyl2` | Sky Level 2 Altitude | feet |
| `skyl3` | Sky Level 3 Altitude | feet |
| `skyl4` | Sky Level 4 Altitude | feet |
| `wxcodes` | Present Weather Codes | códigos METAR |
| `feel` | Apparent Temp (Wind Chill / Heat Index) | Fahrenheit |
| `metar` | Raw METAR string | texto |
| `snowdepth` | Snow Depth | inches |
| `ice_accretion_1hr` | Ice Accretion 1h | inches |
| `ice_accretion_3hr` | Ice Accretion 3h | inches |
| `ice_accretion_6hr` | Ice Accretion 6h | inches |
| `peak_wind_gust` | Peak Wind Gust (PK WND) | knots |
| `peak_wind_drct` | Peak Wind Direction | degrees |
| `peak_wind_time` | Peak Wind Time | timestamp |

### 4.4. Sky Coverage Codes (skyc1-4)

| Código | Significado |
|--------|-------------|
| `CLR` | Clear |
| `FEW` | Few (1/8 - 2/8) |
| `SCT` | Scattered (3/8 - 4/8) |
| `BKN` | Broken (5/8 - 7/8) |
| `OVC` | Overcast (8/8) |

### 4.5. Rate Limits e Restrições (CRÍTICO)

| Regra | Detalhe |
|-------|---------|
| **Throttle por IP** | 1 segundo entre requests. Violação → HTTP 503 |
| **Sem stations** | Máximo **24 horas** de dados |
| **Com stations** | Máximo **1,000 station-years** (ex: 10 estações × 100 anos = 1,000) |
| **Excesso de dados** | HTTP 422 com mensagem "reduce size" |
| **Servidor ocupado** | HTTP 503 — tente novamente |

### 4.6. Estratégia para Grandes Downloads

Para baixar longos períodos ou muitas estações, use **chunks de 24 horas** com exponential backoff (padrão do script oficial):

```javascript
async function downloadWithBackoff(url, maxAttempts = 6) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      if (text && !text.startsWith('ERROR')) return text;
    } catch (e) {
      console.warn(`Attempt ${attempt + 1} failed:`, e.message);
    }
    await new Promise(r => setTimeout(r, 5000)); // 5s entre tentativas
  }
  return '';
}
```

---

## 5. API TAF (`/cgi-bin/request/taf.py`)

Previsões de aeródromo (Terminal Aerodrome Forecast). Dados de previsão meteorológica para aviação.

### 5.1. URL Base

```
https://mesonet.agron.iastate.edu/cgi-bin/request/taf.py
```

### 5.2. Parâmetros

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `station` | array | Código ICAO. Múltiplos via `&station=A&station=B` |
| `sts` | string | Start time ISO |
| `ets` | string | End time ISO |
| `year1`/`month1`/`day1` | int | Data inicial alternativa |
| `year2`/`month2`/`day2` | int | Data final alternativa |
| `hours` | int | Últimas N horas de TAF emitidos |
| `tz` | string | Timezone (default: `UTC`) |
| `format` | string | `onlycomma` (CSV), `tdf` (tab) |
| `direct` | boolean | `yes` para download como arquivo |
| `nometa` | boolean | `yes` para omitir headers |

### 5.3. Exemplo: Buscar TAFs para Guarulhos (SBGR)

```javascript
const base = 'https://mesonet.agron.iastate.edu/cgi-bin/request/taf.py';
const params = new URLSearchParams({
  station: 'SBGR',
  sts: '2024-08-01T00:00:00Z',
  ets: '2024-08-02T00:00:00Z',
  tz: 'America/Sao_Paulo',
  format: 'onlycomma'
});

const resp = await fetch(`${base}?${params}`);
const csv = await resp.text();
// CSV: station,valid,taf
```

---

## 6. API CURRENT CONDITIONS (`/json/current.py`)

Retorna a observação mais recente de uma estação específica em formato JSON.

### 6.1. Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `station` | string | **SIM** | Código ICAO da estação (ex: `SBGL`) |
| `network` | string | **SIM** | Rede IEM (ex: `BR__ASOS`) |
| `callback` | string | Não | JSON-P callback (legado) |

### 6.2. Exemplo

```javascript
const url = 'https://mesonet.agron.iastate.edu/json/current.py?' +
  new URLSearchParams({ station: 'SBGL', network: 'BR__ASOS' });

const data = await (await fetch(url)).json();
// data.tmpf, data.dwpf, data.sknt, data.drct, data.metar, etc.
```

---

## 7. API PIREP (`/cgi-bin/request/gis/pireps.py`)

Pilot Reports — relatórios de condições em voo (turbulência, formação de gelo, teto, etc.).

### 7.1. URL Base

```
https://mesonet.agron.iastate.edu/cgi-bin/request/gis/pireps.py
```

### 7.2. Parâmetros Principais

| Parâmetro | Descrição |
|-----------|-----------|
| `sts` / `ets` | Período de busca (ISO timestamp) |
| `year1`/`month1`/`day1`/`hour1`/`minute1` | Data/hora inicial |
| `year2`/`month2`/`day2`/`hour2`/`minute2` | Data/hora final |
| `format` | `csv` (default) |
| `direct` | `yes` para download como arquivo |
| `nometa` | `yes` para omitir headers |

### 7.3. Exemplo

```javascript
const base = 'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/pireps.py';
const p = new URLSearchParams({
  sts: '2024-08-01T00:00:00Z',
  ets: '2024-08-02T00:00:00Z',
  format: 'csv'
});
const csv = await (await fetch(`${base}?${p}`)).text();
```

---

## 8. API WIND ROSE (`/cgi-bin/mywindrose.py`)

Gera rosas dos ventos a partir de dados de direção e velocidade do vento.

### 8.1. URL Base

```
https://mesonet.agron.iastate.edu/cgi-bin/mywindrose.py
```

### 8.2. Parâmetros

| Parâmetro | Descrição |
|-----------|-----------|
| `station` | Código ICAO da estação |
| `network` | Rede IEM |
| `sts` / `ets` | Período |
| `syear` / `smonth` / `sday` / `eyear` / `emonth` / `eday` | Alternativa por data |
| `hours` | Últimas N horas |
| `wind` | `speed` (padrão) ou `gust` |

### 8.3. Exemplo

```javascript
// Gera HTML com rosa dos ventos para SBGL nos últimos 30 dias
const url = `https://mesonet.agron.iastate.edu/cgi-bin/mywindrose.py?` +
  `station=SBGL&network=BR__ASOS&hours=720&wind=speed`;
// Abre no navegador para visualização gráfica
```

---

## 9. METADATA DE ESTAÇÕES

### 9.1. GeoJSON de Rede (Mais Completo)

```
GET https://mesonet.agron.iastate.edu/geojson/network/{NETWORK}.geojson
```

Retorna FeatureCollection com:
- `properties.sid` — Station ID
- `properties.sname` — Nome da estação
- `properties.elevation` — Elevação (metros)
- `properties.online` — Status online
- `properties.archive_begin` / `archive_end` — Período de dados
- `geometry.coordinates` — [lon, lat]

### 9.2. GeoJSON Global (Todas as Redes ASOS)

```
GET https://mesonet.agron.iastate.edu/geojson/network/AZOS.geojson
```

### 9.3. Tabela HTML/CSV de Rede

```
GET https://mesonet.agron.iastate.edu/sites/networks.php?network={NETWORK}&format=csv&nohtml
```

Formatos: `html` (default), `csv`, `gempak`, `awips`, `madis`, `shp` (shapefile).

---

## 10. EXEMPLOS PRÁTICOS (JAVASCRIPT)

### 10.1. Buscar METAR das últimas 24h para uma estação

```javascript
async function getRecentMetar(station, network) {
  const base = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
  const params = new URLSearchParams({
    station: station,
    network: network,
    data: 'tmpf,dwpf,relh,drct,sknt,alti,mslp,vsby,skyc1,skyl1,metar',
    hours: '24',
    tz: 'Etc/UTC',
    format: 'onlycomma'
  });

  const resp = await fetch(`${base}?${params}`);
  const csv = await resp.text();

  // Parse CSV
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h.trim(), vals[i]?.trim()]));
  });
}

// Uso
const obs = await getRecentMetar('SBGL', 'BR__ASOS');
```

### 10.2. Baixar dados de um mês inteiro (chunks de 24h)

```javascript
async function downloadMonth(station, network, year, month) {
  const base = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
  const daysInMonth = new Date(year, month, 0).getDate();
  const allRows = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const sts = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const ets = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));

    const params = new URLSearchParams({
      station: station,
      network: network,
      data: 'all',
      sts: sts.toISOString().replace('.000', ''),
      ets: ets.toISOString().replace('.000', ''),
      tz: 'Etc/UTC',
      format: 'onlycomma'
    });

    const csv = await fetchWithBackoff(`${base}?${params}`);
    if (!csv) continue;

    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',');
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const vals = line.split(',');
      allRows.push(Object.fromEntries(headers.map((h, i) => [h.trim(), vals[i]?.trim()])));
    }

    // Respeitar throttle de 1s
    if (day < daysInMonth) await sleep(1000);
  }

  return allRows;
}

async function fetchWithBackoff(url, max = 6) {
  for (let i = 0; i < max; i++) {
    try {
      const r = await fetch(url);
      const t = await r.text();
      if (t && !t.startsWith('ERROR')) return t;
    } catch (e) { /* retry */ }
    await sleep(5000);
  }
  return '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

### 10.3. Descobrir todas as estações de um país e baixar dados

```javascript
async function getCountryStations(countryCode) {
  const network = `${countryCode}__ASOS`;
  const url = `https://mesonet.agron.iastate.edu/geojson/network/${network}.geojson`;
  const geo = await (await fetch(url)).json();
  return geo.features.map(f => ({
    id: f.properties.sid,
    name: f.properties.sname,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    elev_m: f.properties.elevation,
    online: f.properties.online
  }));
}

// Listar aeroportos do Brasil com dados meteorológicos
const brStations = await getCountryStations('BR');
// Ex: [{id:"SBGL", name:"Galeao", lat:-22.81, lon:-43.25, ...}, ...]
```

### 10.4. Condição atual de múltiplos aeroportos

```javascript
async function getCurrentConditions(stationIds, network) {
  const results = {};
  const base = 'https://mesonet.agron.iastate.edu/json/current.py';

  // Paralelo (respeitando que são serviços diferentes, sem throttle)
  const promises = stationIds.map(async (sid) => {
    const p = new URLSearchParams({ station: sid, network });
    try {
      const data = await (await fetch(`${base}?${p}`)).json();
      results[sid] = data;
    } catch (e) {
      results[sid] = { error: e.message };
    }
  });

  await Promise.all(promises);
  return results;
}

const current = await getCurrentConditions(
  ['SBGL', 'SBGR', 'SBKP', 'SBBR'],
  'BR__ASOS'
);
```

### 10.5. Buscar TAF recente para um aeroporto

```javascript
async function getRecentTAF(station, hours = 6) {
  const base = 'https://mesonet.agron.iastate.edu/cgi-bin/request/taf.py';
  const p = new URLSearchParams({
    station,
    hours: String(hours),
    tz: 'Etc/UTC',
    format: 'onlycomma',
    nometa: 'yes'
  });
  const csv = await (await fetch(`${base}?${p}`)).text();
  return csv.trim().split('\n').map(line => {
    const [station, valid, ...taf] = line.split(',');
    return { station, valid, taf: taf.join(',') };
  });
}
```

### 10.6. PIREP para uma região (últimas 24h)

```javascript
async function getRecentPireps() {
  const base = 'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/pireps.py';
  const p = new URLSearchParams({
    hours: '24',
    format: 'csv',
    nometa: 'yes'
  });
  const csv = await (await fetch(`${base}?${p}`)).text();
  // Parse CSV de PIREPs contendo: valid, aircraft, altitude, location, sky, weather, turbulence, icing, etc.
  return csv.trim().split('\n').map(l => l.split(','));
}
```

---

## 11. CUIDADOS COM DADOS (GOTCHAS)

### 11.1. Precipitação

- **Fora dos EUA**: Dados de precipitação (`p01i`) são **indisponíveis** ou zerados. O IEM não recebe precipitação nos feeds globais por restrições históricas de distribuição.
- **Dentro dos EUA**: Precipitação disponível, mas o horário de reset varia por estação.

### 11.2. Temperatura

- **Armazenamento interno**: Fahrenheit inteiro (para estações dos EUA)
- **Transmissão**: Celsius inteiro no METAR (sem o `T-group`, há perda de precisão na conversão C→F)
- **T-group ausente**: Dados do MADIS 5-min sem T-group são armazenados como missing no IEM (apenas disponíveis no METAR bruto)
- Use `tmpf` para Fahrenheit e converta para Celsius se necessário: `tmpc = (tmpf - 32) * 5/9`

### 11.3. Valores Missing

- `M` — padrão do IEM (representa missing, qualidade duvidosa, ou não reportado)
- Configurável via parâmetro `missing`: `M`, `null`, ou `empty`
- Trace de precipitação: `0.0001` (padrão) ou `T`, `null`, `empty`

### 11.4. Horário de Verão

- Resumos diários de aeroportos dos EUA cobrem 24h em **horário padrão** (1 AM a 1 AM durante DST)
- Use `tz=Etc/UTC` para consistência e converta no frontend

---

## 12. CHECKLIST DE IMPLEMENTAÇÃO

Antes de considerar qualquer integração com IEM concluída:

- [ ] **Throttle**: Existe delay ≥ 1s entre chamadas ao `asos.py`?
- [ ] **Backoff**: Implementado exponential backoff com 5-6 tentativas?
- [ ] **Chunking**: Períodos > 24h estão divididos em chunks?
- [ ] **Timezone**: Usando `tz=Etc/UTC` para consistência?
- [ ] **Missing values**: Tratando `M` adequadamente no parse?
- [ ] **Precipitação**: Exibindo nota de que precip não está disponível para fora dos EUA?
- [ ] **Conversão de unidades**: Convertendo Fahrenheit→Celsius, knots→km/h, inches→hPa conforme necessário?
- [ ] **Rede correta**: Usando `{UF}_ASOS` para EUA e `{PAIS}__ASOS` para países?
- [ ] **Erro 503**: Tratando serviço indisponível com retry?
- [ ] **Erro 422**: Respeitando limite de 1,000 station-years?

---

**FIM DA SKILL** — Consulte esta documentação sempre que precisar buscar dados meteorológicos históricos ou atuais de aeroportos via Iowa Environmental Mesonet.
