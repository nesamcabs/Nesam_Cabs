import { createContext } from 'react';
import type { View } from 'react-native';

/** A screen that scrolls provides this so a place field can bring its suggestions into view when it opens. */
export const FieldScrollContext = createContext<((node: View) => void) | null>(null);
