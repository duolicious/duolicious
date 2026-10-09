import { isMobileWeb } from '../util/util';

const tiledHearts = require('../assets/tiled-hearts-64.png');

const HeartBackground = ({ children }: { children: React.ReactNode }) => {
  if (isMobileWeb()) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundImage: `url("${tiledHearts.uri}")`,
      }}
    >
      {children}
    </div>
  );
};

export { HeartBackground };
