export const ReviewStatus = (cell) => {
  const value = cell.value;

  if (value === "rejected") {
    return <span style={{ color: "#cf1322", fontWeight: 600 }}>&#x2717;</span>;
  }
  if (value === "accepted" || value === "fixed_and_accepted") {
    return <span style={{ color: "#389e0d", fontWeight: 600 }}>&#x2713;</span>;
  }
  return <span style={{ color: "#999" }}>&#x25CB;</span>;
};

ReviewStatus.style = {
  textAlign: "center",
};
