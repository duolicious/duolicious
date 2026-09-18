import { View, useWindowDimensions } from 'react-native';
import { useState } from 'react';
import { COLUMN_MAX_WIDTH } from '../../constants/constants';
import { ProfileCard } from '../profile-card';
import type { PageItem } from '../search-tab';
import { compositeOver } from '../../util/util';
import * as _ from 'lodash';
import { commonStyles } from '../../styles';
import {
  SIDE_PANEL_GAP,
  SIDE_PANEL_TOP,
  SIDE_PANEL_WIDTH,
  SidePanelCard,
  SidePanelHeading,
  fitsSidePanels,
} from '../navigation/side-panel';
import { legibleSurface } from '../../app-theme/surface';

const PANEL_PADDING = 16;
const NUM_COLUMNS = 2;
const GRID_GAP = 8;
const CARD_WIDTH = (
  SIDE_PANEL_WIDTH
  - 2 * PANEL_PADDING
  - commonStyles.cardBorders.borderLeftWidth
  - commonStyles.cardBorders.borderRightWidth
  - GRID_GAP
) / NUM_COLUMNS;

const SimilarProfiles = ({ items, backgroundColor }: {
  items: PageItem[] | undefined
  backgroundColor: string
}) => {
  const { width, height } = useWindowDimensions();
  const [headingHeight, setHeadingHeight] = useState(0);

  const numRows = Math.max(
    1,
    Math.floor(
      (
        height
        - 2 * SIDE_PANEL_TOP
        - commonStyles.cardBorders.borderTopWidth
        - commonStyles.cardBorders.borderBottomWidth
        - headingHeight
        - PANEL_PADDING
        + GRID_GAP
      ) / (CARD_WIDTH + GRID_GAP)
    )
  );

  if (!fitsSidePanels(width, 2) || !items?.length) {
    return null;
  }

  const surface = legibleSurface(backgroundColor);
  const surfaceColor = compositeOver(surface.backgroundColor, backgroundColor);

  return (
    <SidePanelCard
      surface={surface}
      style={{
        position: 'absolute',
        top: SIDE_PANEL_TOP,
        left: width / 2 + COLUMN_MAX_WIDTH / 2 + SIDE_PANEL_GAP,
        width: SIDE_PANEL_WIDTH,
      }}
    >
      <View onLayout={(e) => setHeadingHeight(e.nativeEvent.layout.height)}>
        <SidePanelHeading isFirst={true} color={surface.color}>
          Similar profiles
        </SidePanelHeading>
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
                surfaceColor={surfaceColor}
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
