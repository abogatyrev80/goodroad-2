# Статус реализации системы кластеризации

## ✅ ЗАВЕРШЕНО:

### 1. Backend кластеризация
- ✅ Модуль `/app/backend/clustering.py`
- ✅ Интеграция в `process_raw_data()`
- ✅ API endpoint `/api/admin/v2/clusters`
- ✅ Автоматическое создание/обновление кластеров
- ✅ TTL система (15 дней)
- ✅ Расчёт confidence на основе подтверждений

### 2. Веб-админка
- ✅ Добавлен режим "Кластеры препятствий"
- ⏳ Нужно добавить функции загрузки/отображения

---

## ⏳ ОСТАЛОСЬ СДЕЛАТЬ:

### 1. Завершить веб-админку (30 минут)

**Добавить в admin_dashboard_v2.html:**

```javascript
// Загрузить кластеры
async function loadClusters() {
    const response = await fetch('/api/admin/v2/clusters?limit=1000');
    const result = await response.json();
    displayClustersList(result.clusters);
    displayClusterMarkers(result.clusters);
}

// Отобразить список кластеров
function displayClustersList(clusters) {
    const eventList = document.getElementById('event-list');
    eventList.innerHTML = clusters.map(cluster => `
        <div class="event-item" onclick="map.setView([${cluster.location.latitude}, ${cluster.location.longitude}], 16);">
            <div class="event-type">
                ${getClusterIcon(cluster.obstacleType)} ${getClusterName(cluster.obstacleType)}
                <span style="float: right; font-size: 0.75rem; color: #60a5fa;">
                    ${cluster.reportCount} подтверждений
                </span>
            </div>
            <div class="event-details">
                <div>Уверенность: ${(cluster.confidence * 100).toFixed(0)}%</div>
                <div>Severity: ${cluster.severity.max} (макс), ${cluster.severity.average.toFixed(1)} (средн)</div>
                <div>Устройств: ${cluster.devices.length}</div>
                <div>Последнее: ${new Date(cluster.lastReported).toLocaleString('ru-RU')}</div>
            </div>
        </div>
    `).join('');
}

// Отобразить маркеры кластеров
function displayClusterMarkers(clusters) {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    clusters.forEach(cluster => {
        const color = getSeverityColor(cluster.severity.max);
        const size = Math.min(40, 15 + cluster.reportCount * 2); // Размер по количеству
        
        const marker = L.circleMarker(
            [cluster.location.latitude, cluster.location.longitude],
            {
                radius: size,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.7
            }
        ).addTo(map);
        
        marker.bindPopup(`
            <div style="min-width: 200px;">
                <h3 style="margin: 0 0 10px 0;">${getClusterIcon(cluster.obstacleType)} ${getClusterName(cluster.obstacleType)}</h3>
                <div><strong>Подтверждений:</strong> ${cluster.reportCount}</div>
                <div><strong>Уверенность:</strong> ${(cluster.confidence * 100).toFixed(0)}%</div>
                <div><strong>Severity:</strong> ${cluster.severity.max} (критичность)</div>
                <div><strong>Устройств:</strong> ${cluster.devices.length}</div>
                <div><strong>Средняя скорость:</strong> ${(cluster.roadInfo.avgSpeed * 3.6).toFixed(0)} км/ч</div>
                <div><strong>Последнее обнаружение:</strong> ${new Date(cluster.lastReported).toLocaleString('ru-RU')}</div>
                <div><strong>Истекает:</strong> ${new Date(cluster.expiresAt).toLocaleDateString('ru-RU')}</div>
            </div>
        `);
        
        markers.push(marker);
    });
}

// Обновить switchViewMode
function switchViewMode(mode) {
    currentViewMode = mode;
    if (mode === 'clusters') {
        loadClusters();
    } else if (mode === 'events') {
        loadEvents();
    } else if (mode === 'rawData') {
        loadRawData();
    }
}

// Инициализация с кластерами
initMap();
loadClusters(); // Вместо loadData()
```

### 2. API для мобильных устройств (20 минут)

**Добавить в server.py:**

```python
@api_router.get("/clusters/nearby")
async def get_nearby_clusters(
    latitude: float,
    longitude: float,
    radius: float = 500,  # метров
    limit: int = 50
):
    """
    🆕 Получить кластеры препятствий поблизости для мобильного приложения
    
    Args:
        latitude: широта текущего положения
        longitude: долгота текущего положения
        radius: радиус поиска в метрах (по умолчанию 500м)
        limit: максимальное количество кластеров
    """
    try:
        if not obstacle_clusterer:
            return {"clusters": []}
        
        # Получаем все активные кластеры
        all_clusters = await obstacle_clusterer.get_active_clusters(limit=1000)
        
        # Фильтруем по расстоянию
        nearby = []
        for cluster in all_clusters:
            distance = obstacle_clusterer.haversine_distance(
                latitude, longitude,
                cluster['location']['latitude'],
                cluster['location']['longitude']
            )
            
            if distance <= radius:
                cluster['distance'] = distance
                nearby.append(cluster)
        
        # Сортируем по расстоянию
        nearby.sort(key=lambda x: x['distance'])
        
        # Ограничиваем результат
        nearby = nearby[:limit]
        
        # Упрощаем структуру для мобильного приложения
        mobile_clusters = []
        for cluster in nearby:
            mobile_clusters.append({
                'id': cluster['_id'],
                'type': cluster['obstacleType'],
                'latitude': cluster['location']['latitude'],
                'longitude': cluster['location']['longitude'],
                'severity': cluster['severity']['max'],
                'confidence': cluster['confidence'],
                'reportCount': cluster['reportCount'],
                'distance': cluster['distance'],
                'avgSpeed': cluster['roadInfo']['avgSpeed']
            })
        
        return {
            "total": len(mobile_clusters),
            "clusters": mobile_clusters
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
```

### 3. Интеграция в мобильное приложение (40 минут)

**Создать `/app/frontend/services/ClusterWarningService.ts`:**

```typescript
class ClusterWarningService {
  private backendUrl: string;
  private warningRadius: number = 500; // метров
  
  constructor(backendUrl: string) {
    this.backendUrl = backendUrl;
  }
  
  async getNearbyClusters(
    latitude: number,
    longitude: number
  ): Promise<Cluster[]> {
    const response = await fetch(
      `${this.backendUrl}/api/clusters/nearby?latitude=${latitude}&longitude=${longitude}&radius=${this.warningRadius}`
    );
    const data = await response.json();
    return data.clusters;
  }
  
  shouldWarn(cluster: Cluster): boolean {
    // Логика значимости:
    // 1. Severity 1-2 (critical/high) - всегда предупреждать
    // 2. Confidence >= 0.75 (3+ подтверждения) - предупреждать
    // 3. ReportCount >= 3 - предупреждать
    
    if (cluster.severity <= 2) return true;
    if (cluster.confidence >= 0.75) return true;
    if (cluster.reportCount >= 3) return true;
    
    return false;
  }
  
  createWarningMessage(cluster: Cluster): string {
    const typeNames = {
      'pothole': 'Яма',
      'speed_bump': 'Лежачий полицейский',
      'bump': 'Неровность'
    };
    
    const typeName = typeNames[cluster.type] || 'Препятствие';
    const distance = Math.round(cluster.distance);
    const confidence = Math.round(cluster.confidence * 100);
    
    return `⚠️ ${typeName} через ${distance}м (${cluster.reportCount} подтверждений, ${confidence}% уверенность)`;
  }
}
```

**Обновить `/app/frontend/app/index.tsx`:**

```typescript
import ClusterWarningService from '../services/ClusterWarningService';

// В компоненте
const clusterWarningService = useRef<ClusterWarningService | null>(null);

useEffect(() => {
  clusterWarningService.current = new ClusterWarningService(backendUrl);
}, []);

// В цикле отслеживания (каждые 5 секунд)
setInterval(async () => {
  if (currentLocationRef.current && clusterWarningService.current) {
    const clusters = await clusterWarningService.current.getNearbyClusters(
      currentLocationRef.current.coords.latitude,
      currentLocationRef.current.coords.longitude
    );
    
    // Проверяем нужно ли предупредить
    for (const cluster of clusters) {
      if (clusterWarningService.current.shouldWarn(cluster)) {
        const message = clusterWarningService.current.createWarningMessage(cluster);
        // Показать уведомление
        Alert.alert('Предупреждение', message);
        break; // Только одно предупреждение за раз
      }
    }
  }
}, 5000);
```

---

## 📊 ЛОГИКА ЗНАЧИМОСТИ

### Когда предупреждать водителя:

1. **Severity 1-2 (Critical/High)**
   - Всегда предупреждать
   - Опасные ямы, серьёзные препятствия

2. **Confidence >= 0.75 (75%+)**
   - 3+ независимых подтверждения
   - Высокая вероятность реального препятствия

3. **ReportCount >= 3**
   - Минимум 3 водителя подтвердили
   - Статистически значимо

4. **Distance < 500м**
   - Достаточно времени для реакции
   - Не слишком рано (не раздражает)

### Приоритизация:

```
Приоритет = (6 - severity) * confidence * (reportCount / 10)

Примеры:
- pothole, severity=1, confidence=0.80, reports=3 → 5 * 0.80 * 0.3 = 1.2 (высокий)
- bump, severity=4, confidence=0.70, reports=1 → 2 * 0.70 * 0.1 = 0.14 (низкий)
```

---

## 🧪 ТЕСТИРОВАНИЕ:

1. **Backend:**
```bash
curl http://localhost:8001/api/admin/v2/clusters
curl "http://localhost:8001/api/clusters/nearby?latitude=55.62&longitude=37.30&radius=500"
```

2. **Веб-админка:**
- Открыть https://goodroad.su/api/admin/dashboard/v2
- Выбрать режим "Кластеры препятствий"
- Проверить отображение маркеров

3. **Мобильное приложение:**
- Запустить отслеживание
- Проехать через препятствия
- Проверить предупреждения

---

## 📝 ОЦЕНКА ВРЕМЕНИ:

- Веб-админка: 30 минут
- API для мобильных: 20 минут
- Мобильное приложение: 40 минут
- Тестирование: 20 минут

**ИТОГО: ~2 часа работы**
