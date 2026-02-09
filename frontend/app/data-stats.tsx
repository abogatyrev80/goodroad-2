/**
 * Статистика отправки данных
 * Показывает состояние очереди, офлайн-батчи и сеть.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import RawDataCollector from '../services/RawDataCollector';

export default function DataStatsScreen() {
  const [bufferSize, setBufferSize] = useState(0);
  const [isOnline, setIsOnline] = useState(false);
  const [offlineQueueLength, setOfflineQueueLength] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    const instance = RawDataCollector.currentInstance;
    if (instance) {
      const stats = instance.getStats();
      setBufferSize(stats.bufferSize);
      setIsOnline(stats.isOnline);
    } else {
      setBufferSize(0);
      setIsOnline(false);
    }
    const queueLen = await RawDataCollector.getOfflineQueueLength();
    setOfflineQueueLength(queueLen);
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 3000);
    return () => clearInterval(interval);
  }, [loadStats]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const handleForceSend = async () => {
    const instance = RawDataCollector.currentInstance;
    if (!instance) return;
    setRefreshing(true);
    try {
      await instance.forceSend();
      await loadStats();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#00d4ff" />
        </Pressable>
        <Text style={styles.headerTitle}>Отправка данных</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00d4ff"
          />
        }
      >
        <View style={styles.infoBox}>
          <Ionicons name="cloud-upload" size={22} color="#00d4ff" />
          <Text style={styles.infoText}>
            Данные с GPS и акселерометра отправляются на сервер. При отсутствии сети они сохраняются и отправляются автоматически при появлении интернета.
          </Text>
        </View>

        {/* Статус сети */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Ionicons
              name={isOnline ? 'wifi' : 'cloud-offline'}
              size={28}
              color={isOnline ? '#22c55e' : '#f59e0b'}
            />
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>
                {isOnline ? 'Сеть доступна' : 'Нет соединения'}
              </Text>
              <Text style={styles.cardSubtitle}>
                {isOnline
                  ? 'Данные отправляются на сервер'
                  : 'Данные сохраняются локально и отправятся при появлении сети'}
              </Text>
            </View>
          </View>
        </View>

        {/* Буфер в памяти */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Ionicons name="layers" size={28} color="#00d4ff" />
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>В буфере</Text>
              <Text style={styles.cardValue}>{bufferSize} точек</Text>
              <Text style={styles.cardSubtitle}>
                Готовятся к отправке
              </Text>
            </View>
          </View>
        </View>

        {/* Офлайн-очередь */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Ionicons
              name="archive"
              size={28}
              color={offlineQueueLength > 0 ? '#f59e0b' : '#64748b'}
            />
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Офлайн-очередь</Text>
              <Text style={styles.cardValue}>{offlineQueueLength} батчей</Text>
              <Text style={styles.cardSubtitle}>
                {offlineQueueLength > 0
                  ? 'Будут отправлены при появлении интернета'
                  : 'Нет данных, ожидающих отправки'}
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          style={styles.primaryButton}
          onPress={handleForceSend}
          disabled={!RawDataCollector.currentInstance}
        >
          <Ionicons name="send" size={22} color="#0f0f23" />
          <Text style={styles.primaryButtonText}>Отправить сейчас</Text>
        </Pressable>
        <Text style={styles.hint}>
          Попытка отправить накопленные данные и офлайн-очередь (если есть сеть).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a3e',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#1a1a3e',
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  cardValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#00d4ff',
    marginTop: 2,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#00d4ff',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f0f23',
  },
  hint: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
