import { ComponentProps } from 'react';
import { Linking } from 'react-native';
import { DefaultText } from './default-text';
import { useHover } from './hover';

declare module 'react-native' {
  interface TextProps {
    href?: string
  }
}

const LinkText = ({ href, style, ...props }: ComponentProps<typeof DefaultText> & {
  href: string
}) => {
  const { hovered, hoverProps } = useHover();

  return (
    <DefaultText
      {...props}
      {...hoverProps}
      href={href}
      onPress={(event) => {
        event.preventDefault();
        Linking.openURL(href);
      }}
      style={[style, { textDecorationLine: hovered ? 'underline' : 'none' }]}
    />
  );
};

export {
  LinkText,
};
