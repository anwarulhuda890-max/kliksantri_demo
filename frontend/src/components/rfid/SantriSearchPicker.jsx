import { useEffect, useRef, useState } from "react";
import api from "../../services/api";
import { FormField, Input } from "../ui/form";

const SEARCH_LIMIT = 20;
const DEBOUNCE_MS = 300;

function SantriSearchPicker({
  id = "santri-search",
  label = "Santri",
  value,
  onChange,
  onSelect,
  disabled = false,
  required = false,
  selectedSantri = null,
  className = "",
  params = null,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (selectedSantri?.nama) {
      setQuery(selectedSantri.nama);
    } else if (!value) {
      setQuery("");
    }
  }, [selectedSantri?.id, selectedSantri?.nama, value]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const q = query.trim();
    if (!q) {
      setMatches([]);
      setIsSearching(false);
      return undefined;
    }

    setIsSearching(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get("/rfid/santri/search", {
          params: { ...(params || {}), search: q, limit: SEARCH_LIMIT },
        });
        setMatches(res.data.data || []);
      } catch (err) {
        console.error(err);
        setMatches([]);
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [params, query]);

  const handleSelect = (santri) => {
    onChange(String(santri.id));
    if (typeof onSelect === "function") {
      onSelect(santri);
    }
    setQuery(santri.nama || "");
    setOpen(false);
    setMatches([]);
  };

  const handleInputChange = (event) => {
    const next = event.target.value;
    setQuery(next);
    setOpen(true);
    if (value && selectedSantri && next !== selectedSantri.nama) {
      onChange("");
      if (typeof onSelect === "function") {
        onSelect(null);
      }
    }
  };

  return (
    <FormField label={label} htmlFor={id} required={required} className={className}>
      <div ref={containerRef} className="santri-search-picker">
        <Input
          id={id}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          placeholder="Ketik nama, NIS, atau UID kartu..."
          disabled={disabled}
          autoComplete="off"
        />

        {open && query.trim() && matches.length > 0 ? (
          <ul className="santri-search-picker__dropdown">
            {matches.map((santri) => (
              <li key={santri.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(santri)}
                  className="santri-search-picker__option"
                >
                  <strong className="santri-search-picker__name">{santri.nama}</strong>
                  <span className="santri-search-picker__meta">
                    {[santri.nis && `NIS: ${santri.nis}`, santri.uid_rfid && `UID: ${santri.uid_rfid}`]
                      .filter(Boolean)
                      .join(" - ") || "-"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {open && query.trim() && !isSearching && matches.length === 0 ? (
          <div className="santri-search-picker__status">Tidak ada santri yang cocok</div>
        ) : null}

        {open && query.trim() && isSearching ? (
          <div className="santri-search-picker__status">Mencari...</div>
        ) : null}
      </div>
    </FormField>
  );
}

export default SantriSearchPicker;
