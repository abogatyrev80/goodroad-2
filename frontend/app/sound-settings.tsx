/**
 * sound-settings.tsx
 * Экран настройки звуков для разных типов событий
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SoundManager from '../components/SoundManager';

export default function SoundSettingsScreen() {

  const handleSave = () => {
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <SoundManager onSave={handleSave} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
});
