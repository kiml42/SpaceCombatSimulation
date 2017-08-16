using Assets.Src.Interfaces;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SpawnTurret : MonoBehaviour, IKnowsEnemyTagAndtag
{
    public string EnemyTag = "Enemy";
    public bool TagChildren = false;

    public string GetEnemyTag()
    {
        return EnemyTag;
    }

    public void SetEnemyTag(string newTag)
    {
        EnemyTag = newTag;
    }
    
    public Transform TurretParent;

	// Use this for initialization
	void Start () {
        var turret = Instantiate(TurretParent, transform.position, transform.rotation, transform);
        turret.parent = transform.parent;
        turret.GetComponent<FixedJoint>().connectedBody = transform.parent.GetComponent<Rigidbody>();
        turret.SendMessage("SetEnemyTag", EnemyTag);
        if (TagChildren) { turret.tag = tag; }
        Destroy(gameObject);
    }
	
	// Update is called once per frame
	void Update () {
		
	}
}
