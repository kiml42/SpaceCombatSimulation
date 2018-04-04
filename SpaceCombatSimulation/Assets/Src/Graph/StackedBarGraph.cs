using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class StackedBarGraph : BaseGraph
    {
        public IDictionary<int, Dictionary<string, int>> _bars;
        public List<Color> Colours = new List<Color>
        {
            Color.white,
            Color.red,
            Color.blue,
            Color.magenta,
            Color.cyan,
            Color.gray,
            Color.green,
            Color.yellow
        };

        public StackedBarGraph(Rect location, Texture backgroundTexture, Texture barTexture, Texture lineTexture, IDictionary<int, Dictionary<string, int>> bars) : base(location, backgroundTexture, barTexture, lineTexture)
        {
            _bars = bars;
        }

        public override void DrawGraph()
        {
            DrawBackground();

            var scale = Get2DBounds();

            var fullHeight = _location.height;
            var fullWidth = _location.width;

            var heightMultiplier = fullHeight / scale.MaxY;

            var barWidth = fullWidth / _bars.Count;

            var xLoc = _location.xMin;

            var allKeys = _bars.SelectMany(b => b.Value.Keys).ToList();

            Dictionary<string, Vector2> previousCenters = null;
            foreach ( var bar in _bars)
            {
                var centers = new Dictionary<string, Vector2>();
                var yLoc = _location.yMax;
                foreach(var segment in bar.Value.OrderByDescending(seg => seg.Key))
                {
                    var barHeight = segment.Value * heightMultiplier;
                    yLoc -= barHeight;
                    Color colour = GetColourForKey(segment.Key, allKeys);
                    var position = new Rect(xLoc, yLoc, barWidth, barHeight);
                    //var content = new GUIContent(segment.Key) { tooltip = segment.Key };
                    //GUI.Button(position, content);
                    GUI.DrawTexture(position, _pointTexture, ScaleMode.StretchToFill, true, 0.5f, colour, 0, 0);

                    var currentCenter = new Vector2(xLoc + (barWidth/2), yLoc + (barHeight / 2));
                    centers[segment.Key] = currentCenter;

                    if(previousCenters != null && previousCenters.ContainsKey(segment.Key))
                    {
                        var previousCenter = previousCenters[segment.Key];
                        GraphUtils.DrawLineBetweenPoints(previousCenter, currentCenter, _lineTexture, colour);
                    }
                }
                previousCenters = centers;
                xLoc += barWidth;
            }
        }

        private Color GetColourForKey(string key, List<string> keys)
        {
            var index = keys.IndexOf(key);

            return Colours[index % Colours.Count];
        }

        public override Bounds2D Get2DBounds()
        {
            if (_bars.Any())
            {
                return new Bounds2D(
                    0,
                    0,
                    _bars.Max(bar => bar.Key),
                    _bars.Max(bar => bar.Value.Sum(barValue => barValue.Value))
                    );
            }
            return Bounds2D.Default;
        }
    }
}
