import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../ui/form";

const MAX_RESULTS = 30;

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function getSantriLabel(santri) {
  return santri?.nama || "";
}

function getSantriMeta(santri) {
  return [santri?.nis && `NIS: ${santri.nis}`, santri?.kelas || santri?.nama_kelas]
    .filter(Boolean)
    .join(" - ");
}

function SearchableSantriSelect({
  id,
  value,
  santri = [],
  onChange,
  placeholder = "Cari nama santri...",
  error = "",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef(null);

  const selectedSantri = useMemo(
    () => santri.find((item) => String(item.id) === String(value)),
    [santri, value],
  );

  const selectedLabel = getSantriLabel(selectedSantri);
  const displayValue = focused ? query : selectedLabel;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const matches = useMemo(() => {
    const q = normalize(displayValue);
    const source = q
      ? santri.filter((item) => {
          const haystack = normalize(
            [item.nama, item.nis, item.kelas, item.nama_kelas].filter(Boolean).join(" "),
          );
          return haystack.includes(q);
        })
      : santri;

    return source.slice(0, MAX_RESULTS);
  }, [displayValue, santri]);

  const handleInputChange = (event) => {
    const next = event.target.value;
    setQuery(next);
    setOpen(true);

    if (value && next !== selectedLabel) {
      onChange("");
    }
  };

  const handleSelect = (item) => {
    onChange(String(item.id));
    setQuery(getSantriLabel(item));
    setOpen(false);
    setFocused(false);
  };

  return (
    <div ref={containerRef} className="santri-search-select">
      <Input
        id={id}
        type="search"
        value={displayValue}
        onChange={handleInputChange}
        onFocus={() => {
          setFocused(true);
          setQuery(selectedLabel);
          setOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
      />

      {open ? (
        <div className="santri-search-select__dropdown">
          {matches.length > 0 ? (
            matches.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(item)}
                className="santri-search-select__option"
              >
                <span className="santri-search-select__name">{item.nama}</span>
                {getSantriMeta(item) ? (
                  <span className="santri-search-select__meta">{getSantriMeta(item)}</span>
                ) : null}
              </button>
            ))
          ) : (
            <div className="santri-search-select__empty" role={error ? "alert" : undefined}>
              {error || "Santri tidak ditemukan"}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default SearchableSantriSelect;
