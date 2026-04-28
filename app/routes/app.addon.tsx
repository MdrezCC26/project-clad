export default function AddonPage() {
  return (
    <s-page heading="Z-Bars addon">
      <s-section heading="Quick launch">
        <s-paragraph>Open the Z-Bars addon and play the featured animation.</s-paragraph>
        <img
          src="/z-bars-button.png"
          alt="Open Z-Bars addon"
          style={{
            width: "220px",
            borderRadius: "18px",
            border: "2px solid #111",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
          }}
        />
      </s-section>
      <s-section heading="Featured animation">
        <s-paragraph>The GIF below auto-plays on load.</s-paragraph>
        <img
          src="https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZ2R6bjYyazY3djNhMmZ6OGwwbGdsOTJxZ2M2a3JuNGd3b2VibXdhNiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ds81f3a3qfzyAXOQRL/giphy.gif"
          alt="Z-Bars addon animation"
          style={{
            maxWidth: "100%",
            width: "420px",
            borderRadius: "12px",
            border: "1px solid #d9d9d9",
          }}
        />
      </s-section>
    </s-page>
  );
}
