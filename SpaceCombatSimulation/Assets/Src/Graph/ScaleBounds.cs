namespace Assets.Src.Graph
{
    public class ScaleBounds
    {
        public float MinX;
        public float MinY;

        public float MaxX;
        public float MaxY;

        public ScaleBounds(float minX, float minY, float maxX, float maxY)
        {
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
        }
    }
}
