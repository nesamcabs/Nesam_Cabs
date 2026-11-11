import React from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Text } from '../components/nx/Text';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { RootStackParamList, AuthStackParamList, RegistrationStackParamList, WorkspaceTabParamList } from './types';
import { Colors } from '../theme/colors';

import { DriverAuthScreen } from '../screens/auth/DriverAuthScreen';
import DashboardScreen from '../screens/DashboardScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import TripExecutionScreen from '../screens/TripExecutionScreen';
import EarningsScreen from '../screens/EarningsScreen';
import DriverProfileScreen from '../screens/DriverProfileScreen';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AuthNavigator = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.darkBg } }}>
    <AuthStack.Screen name="Welcome" component={DriverAuthScreen} />
    <AuthStack.Screen name="PhoneEntry" component={DriverAuthScreen} />
    <AuthStack.Screen name="OtpVerify" component={DriverAuthScreen} />
  </AuthStack.Navigator>
);

const Tab = createBottomTabNavigator<WorkspaceTabParamList>();
const WorkspaceNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: Colors.black, borderTopColor: '#2C2C2E' },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        sceneStyle: { backgroundColor: Colors.darkBg },
      }}
    >
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: 'Home', tabBarIcon: () => <Text>🏠</Text> }} />
      <Tab.Screen name="MarketplaceTab" component={MarketplaceScreen} options={{ title: 'Trips', tabBarIcon: () => <Text>🚗</Text> }} />
      <Tab.Screen name="TripTab" component={TripExecutionScreen} options={{ title: 'Active', tabBarIcon: () => <Text>📍</Text> }} />
      <Tab.Screen name="EarningsTab" component={EarningsScreen} options={{ title: 'Earnings', tabBarIcon: () => <Text>💰</Text> }} />
      <Tab.Screen name="ProfileTab" component={DriverProfileScreen} options={{ title: 'Profile', tabBarIcon: () => <Text>👤</Text> }} />
    </Tab.Navigator>
  );
};

export const RootNavigator = () => {
  const { user, account, authLoading, accountLoading, accountError, retryAccount, signOut } = useAuth();

  if (authLoading || accountLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Connecting to NESAM Network...</Text>
      </View>
    );
  }

  if (accountError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Connection Failed</Text>
        <Text style={styles.errorSub}>Could not load partner account.</Text>
        <TouchableOpacity style={styles.btn} onPress={retryAccount}>
          <Text style={styles.btnText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { backgroundColor: Colors.black, marginTop: 10 }]} onPress={signOut}>
          <Text style={styles.btnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {!user ? (
          <AuthNavigator />
        ) : !account ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
            <Text style={styles.statusTitle}>Registration Under Review</Text>
            <Text style={styles.statusSub}>
              Your driver account documents are pending verification by the NESAM dispatch team.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={retryAccount}>
              <Text style={styles.btnText}>Refresh Status</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#333', marginTop: 10 }]} onPress={signOut}>
              <Text style={styles.btnText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        ) : account.driver.approvalStatus === 'Pending' ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>⏳</Text>
            <Text style={styles.statusTitle}>Partner Verification Pending</Text>
            <Text style={styles.statusSub}>
              Hello {account.driver.name}. Your documents have been submitted and are being verified.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={retryAccount}>
              <Text style={styles.btnText}>Check Status</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#333', marginTop: 10 }]} onPress={signOut}>
              <Text style={styles.btnText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        ) : account.driver.approvalStatus === 'Suspended' ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🚫</Text>
            <Text style={styles.statusTitle}>Partner Account Suspended</Text>
            <Text style={styles.statusSub}>Please contact NESAM Partner Support for assistance.</Text>
            <TouchableOpacity style={styles.btn} onPress={signOut}>
              <Text style={styles.btnText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <WorkspaceNavigator />
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: Colors.darkBg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: { color: Colors.textSecondary, marginTop: 14, fontSize: 14 },
  statusTitle: { color: Colors.white, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  statusSub: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  errorTitle: { color: Colors.error, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  errorSub: { color: Colors.textSecondary, fontSize: 14, marginBottom: 16 },
  btn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { color: Colors.white, fontWeight: '800', fontSize: 15 },
});