// Temporary repro harness for the Android reaction-bar exit flicker.
// Rendered instead of the real app via a temporary edit to App.tsx.
// Delete this file once the flicker is fixed.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ReactionMenu } from './components/conversation-screen/reaction-controls';
import type { AnchorMeasurement } from './components/anchored-overlay';

const anchor: AnchorMeasurement = {
  x: 0,
  y: 0,
  width: 200,
  height: 40,
  pageX: 80,
  pageY: 500,
};

const ReproApp = () => {
  const [visible, setVisible] = useState(false);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#cccccc',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Pressable
        onPress={() => setVisible(true)}
        style={{
          padding: 20,
          backgroundColor: '#7700ff',
          borderRadius: 8,
        }}
      >
        <Text style={{ color: 'white' }}>Open reaction bar</Text>
      </Pressable>
      <ReactionMenu
        visible={visible}
        showDismissLayer={visible}
        anchor={anchor}
        selected={undefined}
        onPick={() => setVisible(false)}
        onDismiss={() => setVisible(false)}
      />
    </View>
  );
};

export default ReproApp;
