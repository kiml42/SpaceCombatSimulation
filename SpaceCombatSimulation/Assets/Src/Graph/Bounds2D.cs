namespace Assets.Src.Graph
{
    public class Bounds2D
    {
        public float MinX;
        public float MinY;

        public float MaxX;
        public float MaxY;

        public Bounds2D(float minX, float minY, float maxX, float maxY)
        {
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
        }

        public static Bounds2D Default {
            get
            {
                return new Bounds2D(-1, -1, 1, 1);
            }
        }
    }
}
