import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { fonts } from '../theme';
// Stubbing logout since it might not be implemented in authService yet
// import { logout } from '../services/authService';
const logout = async () => { console.log('Logout stub'); };

import type { AuthStackParamList, HomeStackParamList, MainTabParamList, RootStackParamList } from './types';

// Importing screens (using stubs for now)
const PlaceholderScreen = ({ name }: { name: string }) => (
  <View style={styles.center}>
    <Text>{name}</Text>
  </View>
);

const WelcomeScreen = () => <PlaceholderScreen name="Welcome" />;
const PhoneEntryScreen = () => <PlaceholderScreen name="Phone Entry" />;
const OtpVerifyScreen = () => <PlaceholderScreen name="OTP Verify" />;
const ProfileSetupScreen = () => <PlaceholderScreen name="Profile Setup" />;

const HomeMainScreen = () => <PlaceholderScreen name="Home Main" />;
const BookRideScreen = () => <PlaceholderScreen name="Book Ride" />;
const ActiveRideScreen = () => <PlaceholderScreen name="Active Ride" />;
const TripReceiptScreen = () => <PlaceholderScreen name="Trip Receipt" />;
const RateTripScreen = () => <PlaceholderScreen name="Rate Trip" />;
const SavedPlacesScreen = () => <PlaceholderScreen name="Saved Places" />;

const TripsScreen = () => <PlaceholderScreen name="Trips" />;
const NotificationsScreen = () => <PlaceholderScreen name="Notifications" />;
const SupportScreen = () => <PlaceholderScreen name="Support" />;
const ProfileScreen = () => <PlaceholderScreen name="Profile" />;

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

const AuthNavigator = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="Welcome" component={WelcomeScreen} />
    <AuthStack.Screen name="PhoneEntry" component={PhoneEntryScreen} />
    <AuthStack.Screen name="OtpVerify" component={OtpVerifyScreen} />
    <AuthStack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
  </AuthStack.Navigator>
);

const HomeNavigator = () => (
  <HomeStack.Navigator screenOptions={{ headerShown: false }}>
    <HomeStack.Screen name="HomeMain" component={HomeMainScreen} />
    <HomeStack.Screen name="BookRide" component={BookRideScreen} />
    <HomeStack.Screen name="ActiveRide" component={ActiveRideScreen} />
    <HomeStack.Screen name="TripReceipt" component={TripReceiptScreen} />
    <HomeStack.Screen name="RateTrip" component={RateTripScreen} />
    <HomeStack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
  </HomeStack.Navigator>
);

const MainNavigator = () => (
  <MainTab.Navigator
    screenOptions={({ route }) => ({
      headerShown: false,
      tabBarIcon: ({ color, size }) => {
        let iconName = '';
        switch (route.name) {
          case 'HomeTab': iconName = '🏠'; break;
          case 'TripsTab': iconName = '🗂️'; break;
          case 'NotificationsTab': iconName = '🔔'; break;
          case 'SupportTab': iconName = '💬'; break;
          case 'ProfileTab': iconName = '👤'; break;
        }
        return <Text style={{ fontSize: size - 4, color }}>{iconName}</Text>;
      },
      tabBarActiveTintColor: Colors.primary,
      tabBarInactiveTintColor: '#6B7280',
      tabBarStyle: { backgroundColor: Colors.black },
    })}
  >
    <MainTab.Screen name="HomeTab" component={HomeNavigator} options={{ title: 'Home' }} />
    <MainTab.Screen name="TripsTab" component={TripsScreen} options={{ title: 'Trips' }} />
    <MainTab.Screen name="NotificationsTab" component={NotificationsScreen} options={{ title: 'Alerts' }} />
    <MainTab.Screen name="SupportTab" component={SupportScreen} options={{ title: 'Support' }} />
    <MainTab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: 'Profile' }} />
  </MainTab.Navigator>
);

export const RootNavigator = () => {
  const { user, profile, authLoading, profileLoading, profileError, retryProfile } = useAuth();

  if (authLoading) {
    return (
      <View style={[styles.center, styles.container]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {!user ? (
          <AuthNavigator />
        ) : profileLoading ? (
          <View style={[styles.center, styles.container]}>
             <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : profileError ? (
          <View style={[styles.center, styles.container]}>
            <Text style={styles.errorText}>Failed to load profile.</Text>
            <TouchableOpacity style={styles.button} onPress={retryProfile}>
              <Text style={styles.buttonText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={logout}>
              <Text style={styles.secondaryButtonText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        ) : !profile ? (
          <AuthStack.Navigator screenOptions={{ headerShown: false }}>
            <AuthStack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
          </AuthStack.Navigator>
        ) : profile.status === 'Suspended' ? (
          <View style={[styles.center, styles.container]}>
            <Text style={styles.errorText}>Your account is suspended.</Text>
            <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={logout}>
              <Text style={styles.secondaryButtonText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            <RootStack.Screen name="Main" component={MainNavigator} />
          </RootStack.Navigator>
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Fallback, assuming Colors.background exists
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#EF4444', // Fallback error color
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#000000', // Fallback primary color
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
    minWidth: 120,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: fonts.bold,
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#6B7280',
  },
  secondaryButtonText: {
    fontFamily: fonts.bold,
    color: '#6B7280',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
