import { View, useWindowDimensions } from 'react-native';
import { useState } from 'react';
import { COLUMN_MAX_WIDTH } from '../../constants/constants';
import { ProfileCard } from '../profile-card';
import type { PageItem } from '../search-tab';
import { isMobile } from '../../util/util';
import * as _ from 'lodash';
import { commonStyles } from '../../styles';
import { SidePanelCard, SidePanelHeading } from '../navigation/side-panel';

const PANEL_WIDTH = 320;
const PANEL_GAP = 32;
const PANEL_TOP = 20;
const PANEL_PADDING = 16;
const NUM_COLUMNS = 2;
const GRID_GAP = 8;
const CARD_WIDTH = (
  PANEL_WIDTH
  - 2 * PANEL_PADDING
  - commonStyles.cardBorders.borderLeftWidth
  - commonStyles.cardBorders.borderRightWidth
  - GRID_GAP
) / NUM_COLUMNS;

const SimilarProfiles = ({ items }: { items: PageItem[] | undefined }) => {
  const { width, height } = useWindowDimensions();
  const [headingHeight, setHeadingHeight] = useState(0);

  const numRows = Math.max(
    1,
    Math.floor(
      (
        height
        - 2 * PANEL_TOP
        - commonStyles.cardBorders.borderTopWidth
        - commonStyles.cardBorders.borderBottomWidth
        - headingHeight
        - PANEL_PADDING
        + GRID_GAP
      ) / (CARD_WIDTH + GRID_GAP)
    )
  );

  if (
    isMobile() ||
    width < COLUMN_MAX_WIDTH + 2 * (PANEL_WIDTH + 2 * PANEL_GAP) ||
    !items?.length
  ) {
    return null;
  }

  return (
    <SidePanelCard
      style={{
        position: 'absolute',
        top: PANEL_TOP,
        left: width / 2 + COLUMN_MAX_WIDTH / 2 + PANEL_GAP,
        width: PANEL_WIDTH,
      }}
    >
      <View onLayout={(e) => setHeadingHeight(e.nativeEvent.layout.height)}>
        <SidePanelHeading isFirst={true}>Similar profiles</SidePanelHeading>
      </View>
      <View
        style={{
          gap: GRID_GAP,
          paddingHorizontal: PANEL_PADDING,
          paddingBottom: PANEL_PADDING,
        }}
      >
        {_.chunk(items.slice(0, numRows * NUM_COLUMNS), NUM_COLUMNS).map((row) =>
          <View
            key={row[0].prospect_uuid}
            style={{ flexDirection: 'row', gap: GRID_GAP }}
          >
            {row.map((item) =>
              <ProfileCard
                key={item.prospect_uuid}
                item={item}
                numColumns={NUM_COLUMNS}
                cardWidth={CARD_WIDTH}
              />
            )}
          </View>
        )}
      </View>
    </SidePanelCard>
  );
};

export {
  SimilarProfiles,
};
