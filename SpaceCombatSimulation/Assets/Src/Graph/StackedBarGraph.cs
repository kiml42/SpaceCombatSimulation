using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class StackedBarGraph : BaseGraph
    {
        public IDictionary<int, Dictionary<string, int>> _bars;
        private Texture _barTexture;

        public StackedBarGraph(Rect location, Texture backgroundTexture, Texture barTexture, IDictionary<int, Dictionary<string, int>> bars) : base(location, backgroundTexture)
        {
            _bars = bars;
            _barTexture = barTexture;
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
            foreach ( var bar in _bars)
            {
                var yLoc = _location.yMax;
                foreach(var segment in bar.Value)
                {
                    var barHeight = segment.Value * heightMultiplier;
                    var content = new GUIContent(_barTexture, segment.Key);
                    GUI.Box(new Rect(xLoc, yLoc, barWidth, barHeight), content);
                }
            }

            var zeroZeroUiPoint = new GraphPoint(0, 0).ToUiPoint(scale, _location);
            GUI.Label(new Rect(zeroZeroUiPoint.x, zeroZeroUiPoint.y, 40, 40), "0");
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
