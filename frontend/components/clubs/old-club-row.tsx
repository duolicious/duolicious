import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { DefaultText } from '../default-text';
import { LinearGradient } from 'expo-linear-gradient';
import { isMobile } from '../../util/util';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  selectSearchClub,
  sortClubs,
  useJoinedClubs,
  useSearchClub,
} from '../../club/club';
import { useAppTheme } from '../../app-theme/app-theme';
import { AnimatedPressable, HoverCircle, hoverTransition, useHover } from '../hover';

const styles = StyleSheet.create({
  clubsScrollViewContainer: {
    alignItems: 'center',
  },
  clubsContentContainerContainer: {
    borderRadius: 5,
    overflow: 'hidden',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 600,
  },
  clubTitle: {
    fontSize: 18,
    fontWeight: '900',
    paddingLeft: 5,
    paddingRight: 10,
    paddingVertical: 5,
  },
  clubContainerEveryone: {
    marginHorizontal: 30,
    borderRadius: 5,
    overflow: 'hidden',
  },
  clubContainer: {
    borderRadius: 5,
    overflow: 'hidden',
  },
  clubArrow: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubText: {
    fontSize: 16,
    fontFamily: 'Trueno',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});

const LeftContinuation = ({scrollLeft}: {scrollLeft: () => void}) => {
  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  if (isMobile()) {
    return (
      <LinearGradient
        start={{x: 0, y: 0 }}
        end={{x: 1, y: 0 }}
        colors={['#00000044', '#00000000']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,

          height: '100%',
          width: 10,

          zIndex: 999,
        }}
      />
    );
  } else {
    return (
      <Pressable
        onPress={scrollLeft}
        {...hoverProps}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,

          height: '100%',
          width: 40,

          zIndex: 999,
        }}
      >
        <LinearGradient
          start={{x: 0, y: 0 }}
          end={{x: 1, y: 0 }}
          locations={[0.0, 0.8, 1.0]}
          colors={[
            `${appTheme.primaryColor}ff`,
            `${appTheme.primaryColor}e5`,
            `${appTheme.primaryColor}00`,
          ]}
          style={{
            height: '100%',
            width: '100%',
            justifyContent: 'center',
            alignItems: 'flex-start',
          }}
        >
          <View style={styles.clubArrow}>
            <HoverCircle visible={hovered} inset={0} />
            <Ionicons
              style={{
                fontSize: 26,
                color: appTheme.secondaryColor,
              }}
              name="chevron-back"
            />
          </View>
        </LinearGradient>
      </Pressable>
    );
  }
};

const RightContinuation = ({scrollRight}: {scrollRight: () => void}) => {
  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  if (isMobile()) {
    return (
      <LinearGradient
        start={{x: 0, y: 0 }}
        end={{x: 1, y: 0 }}
        colors={['#00000000', '#00000044']}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,

          height: '100%',
          width: 10,

          zIndex: 999,
        }}
      />
    );
  } else {
    return (
      <Pressable
        onPress={scrollRight}
        {...hoverProps}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,

          height: '100%',
          width: 40,

          zIndex: 999,
        }}
      >
        <LinearGradient
          start={{x: 0, y: 0 }}
          end={{x: 1, y: 0 }}
          locations={[0.0, 0.2, 1.0]}
          colors={[
            `${appTheme.primaryColor}00`,
            `${appTheme.primaryColor}e5`,
            `${appTheme.primaryColor}ff`,
          ]}
          style={{
            height: '100%',
            width: '100%',
            justifyContent: 'center',
            alignItems: 'flex-end',
          }}
        >
          <View style={styles.clubArrow}>
            <HoverCircle visible={hovered} inset={0} />
            <Ionicons
              style={{
                fontSize: 26,
                color: appTheme.secondaryColor,
              }}
              name="chevron-forward"
            />
          </View>
        </LinearGradient>
      </Pressable>
    );
  }
};

const ClubRowItem = ({ name, isSelected, style, onPress, onLayout }: {
  name: string
  isSelected: boolean
  style: ViewStyle
  onPress: () => void
  onLayout?: (e: LayoutChangeEvent) => void
}) => {
  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  return (
    <AnimatedPressable
      style={[
        style,
        {
          backgroundColor: hovered && !isSelected
            ? appTheme.hoverOverlayColor
            : 'transparent',
        },
        hoverTransition(['backgroundColor']),
      ]}
      onPress={onPress}
      onLayout={onLayout}
      {...hoverProps}
    >
      <DefaultText
        style={[
          styles.clubText,
          isSelected ? {
            color: appTheme.primaryColor,
            backgroundColor: appTheme.secondaryColor,
          } : {
            color: appTheme.secondaryColor,
          },
        ]}
      >
        {name}
      </DefaultText>
    </AnimatedPressable>
  );
};

const OldClubRow = () => {
  const { appTheme } = useAppTheme();

  const scrollJumpSize = 150;

  const scrollViewRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);

  const hasJumpedToClubRef = useRef(false);

  const [isTop, setIsTop] = useState(true);
  const [isBottom, setIsBottom] = useState(true);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const joined = useJoinedClubs();
  const clubs = sortClubs(joined ?? []);
  const selectedClub = useSearchClub();

  const checkIsTop = useCallback((nativeEvent: NativeScrollEvent) => {
    const isCloseToTop = nativeEvent.contentOffset.x <= 10;

    setIsTop(isCloseToTop);
  }, [setIsTop]);

  const checkIsBottom = useCallback((nativeEvent: NativeScrollEvent) => {
    const isCloseToBottom = (
      nativeEvent.layoutMeasurement.width +
      nativeEvent.contentOffset.x) >= nativeEvent.contentSize.width - 10;

    setIsBottom(isCloseToBottom);
  }, [setIsBottom]);

  const onScroll = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollXRef.current = nativeEvent.contentOffset.x;

    checkIsTop(nativeEvent);
    checkIsBottom(nativeEvent);
  }, [checkIsTop, checkIsBottom]);

  const onContentSizeChange = useCallback((width: number) =>
    setContentWidth(width), []);

  const onScrollViewLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) =>
    setContainerWidth(nativeEvent.layout.width), []);

  const onSelectedClubLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    (async () => {
      if (!scrollViewRef.current) {
        return;
      }

      if (hasJumpedToClubRef.current) {
        return;
      }

      scrollViewRef.current.scrollTo({
        x: nativeEvent.layout.x - scrollJumpSize,
        animated: false,
      });

      hasJumpedToClubRef.current = true;
    })();
  }, []);

  const scrollLeft = useCallback(() => {
    if (!scrollViewRef.current) {
      return;
    }
    scrollViewRef.current.scrollTo({
      x: scrollXRef.current - scrollJumpSize,
      animated: true,
    });
  }, []);

  const scrollRight = useCallback(() => {
    if (!scrollViewRef.current) {
      return;
    }
    scrollViewRef.current.scrollTo({
      x: scrollXRef.current + scrollJumpSize,
      animated: true,
    });
  }, []);

  useEffect(() => {
    if (containerWidth > 0 && contentWidth > 0) {
      setIsBottom(containerWidth >= contentWidth);
    }
  }, [containerWidth, contentWidth]);

  useEffect(() => {
    hasJumpedToClubRef.current = false;
  }, [joined]);

  if (!clubs.length) {
    return null;
  }

  return (
    <View
      style={{
        width: '100%',
        alignItems: 'stretch',
        alignSelf: 'center',
        paddingTop: 10,
        paddingBottom: 5,
        paddingHorizontal: 5,
        overflow: 'hidden',
        zIndex: 9999,
        opacity: 0.9,
        backgroundColor: appTheme.primaryColor,
      }}
    >
      <View style={styles.clubsContentContainerContainer}>
        <ScrollView
          ref={scrollViewRef}
          horizontal={true}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.clubsScrollViewContainer}
          onScroll={onScroll}
          onContentSizeChange={onContentSizeChange}
          onLayout={onScrollViewLayout}
        >
          <DefaultText style={styles.clubTitle}>
            CLUBS
          </DefaultText>

          <ClubRowItem
            name="Everyone"
            isSelected={selectedClub === null}
            style={styles.clubContainerEveryone}
            onPress={() => selectSearchClub(null)}
          />

          {clubs.map((club) =>
            <ClubRowItem
              key={club}
              name={club}
              isSelected={selectedClub === club}
              style={styles.clubContainer}
              onPress={() => selectSearchClub(club)}
              onLayout={
                selectedClub === club && !hasJumpedToClubRef.current ?
                  onSelectedClubLayout :
                  undefined
              }
            />
          )}
        </ScrollView>

        {!isTop && <LeftContinuation scrollLeft={scrollLeft} />}
        {!isBottom && <RightContinuation scrollRight={scrollRight} />}
      </View>
    </View>
  );
};


export {
  OldClubRow,
};
