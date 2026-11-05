import { Alert } from 'react-native';
import type { PickSource } from '../services/storageService';

/** Native action sheet: camera or gallery. Resolves null if dismissed. */
export function choosePhotoSource(title = 'Profile photo'): Promise<PickSource | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      'Take a new photo or choose one from your gallery.',
      [
        { text: 'Camera', onPress: () => resolve('camera') },
        { text: 'Gallery', onPress: () => resolve('library') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}
