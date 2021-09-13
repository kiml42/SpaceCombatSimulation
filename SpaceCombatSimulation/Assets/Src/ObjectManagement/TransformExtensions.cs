using UnityEngine;

namespace Assets.Src.ObjectManagement
{
    public static class TransformExtensions
    {
        /// <summary>
        /// True if the transform is null, or if the transform is no longer connected to a game object.
        /// </summary>
        /// <param name="transform"></param>
        /// <returns></returns>
        public static bool IsInvalid(this Transform transform)
        {
            return transform == null || transform.gameObject == null;
        }

        /// <summary>
        /// true if the transform is not null, and is still connected to a game object.
        /// </summary>
        /// <param name="transform"></param>
        /// <returns></returns>
        public static bool IsValid(this Transform transform)
        {
            return !IsInvalid(transform);
        }

        public static void SetColor(this Transform transform, float R, float G, float B, float A = 1)
        {
            var colour = new Color(R, G, B, A);
            transform.SetColor(colour);
        }

        public static void SetColor(this Transform transform, Color colour)
        {
            var renderers = transform.GetComponentsInChildren<Renderer>();
            foreach(var r in renderers)
            {
                r.material.color = colour;
            }
            var colourSetters = transform.GetComponentsInChildren<ColourSetter>();
            foreach (var c in colourSetters)
            {
                c.Colour = colour;
            }
        }

        public static void SetVelocity(this Transform transform, Vector3 velocity)
        {
            var childRigidbodies = transform.GetComponentsInChildren<Rigidbody>();

            foreach (var r in childRigidbodies)
            {
                r.velocity = velocity;
            }
        }

        public static Transform FindOldestParent(this Transform transform)
        {
            var parent = transform.parent;
            if (parent == null)
            {
                return transform;
            }
            return FindOldestParent(parent);
        }
    }
}
