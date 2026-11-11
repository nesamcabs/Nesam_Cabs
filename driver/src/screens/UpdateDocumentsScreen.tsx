import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useDriverData } from '../context/DriverData';
import { RegistrationScreen } from './RegistrationScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'UpdateDocuments'>;

/** Approved driver refreshing KYC; the account stays approved, docStatus → Pending. */
export function UpdateDocumentsScreen({ navigation }: Props) {
  const { account } = useDriverData();
  return (
    <RegistrationScreen
      uid={account.driver.id}
      mode="update"
      initial={account}
      fleetDriver={!!account.driver.vendorId}
      currentStatus={account.driver.approvalStatus}
      onDone={() => navigation.goBack()}
      onCancel={() => navigation.goBack()}
    />
  );
}
