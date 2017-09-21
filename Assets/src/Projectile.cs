using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Projectile :MonoBehaviour
{
	public static GameObject projectileParent;
	// Use this for initialization
	void Start ()
	{
		if (projectileParent == null)
		{
			projectileParent = new GameObject("Projectiles");
		}
		transform.SetParent(projectileParent.transform);
	}
	
}
